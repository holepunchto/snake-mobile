#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

for variable in BUILD_PROFILE BUILD_NUMBER BUILD_CERTIFICATE_BASE64 P12_PASSWORD IOS_PROVISIONING_PROFILE_BASE64 APPLE_TEAM_ID; do
  if [[ -z "${!variable:-}" ]]; then
    echo "Missing environment variable: $variable" >&2
    exit 1
  fi
done

case "$BUILD_PROFILE" in
  production|preview) ;;
  *) echo "Unsupported build profile: $BUILD_PROFILE" >&2; exit 1 ;;
esac
[[ "$BUILD_NUMBER" =~ ^[1-9][0-9]*$ ]] || { echo "BUILD_NUMBER must be a positive integer" >&2; exit 1; }

ARTIFACT_DIR="$PWD/dist/ios"
SIGNING_DIR=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/snake-ios.XXXXXX")
KEYCHAIN_PATH="$SIGNING_DIR/signing.keychain-db"
PROFILE_PATH=""
KEYCHAINS_CHANGED=false
ORIGINAL_KEYCHAINS=()

cleanup() {
  local status=$?
  trap - EXIT
  set +e
  if [[ "$KEYCHAINS_CHANGED" == true ]]; then
    security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}"
  fi
  security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1
  [[ -z "$PROFILE_PATH" ]] || rm -f "$PROFILE_PATH"
  rm -rf "$SIGNING_DIR"
  exit "$status"
}
trap cleanup EXIT

mkdir -p "$ARTIFACT_DIR"
export ARTIFACT_DIR SIGNING_DIR KEYCHAIN_PATH

node <<'NODE'
const fs = require('fs')
const config = require('./app.config.js')({ config: require('./app.json').expo })
const metadata = {
  platform: 'ios',
  profile: process.env.BUILD_PROFILE,
  applicationId: config.ios.bundleIdentifier,
  version: config.version,
  buildNumber: String(process.env.BUILD_NUMBER)
}
fs.writeFileSync(`${process.env.ARTIFACT_DIR}/build-metadata.json`, JSON.stringify(metadata, null, 2) + '\n')
NODE

python3 <<'PY'
import base64
import os
from pathlib import Path

directory = Path(os.environ['SIGNING_DIR'])
for variable, filename in [('BUILD_CERTIFICATE_BASE64', 'certificate.p12'), ('IOS_PROVISIONING_PROFILE_BASE64', 'profile.mobileprovision')]:
    path = directory / filename
    path.write_bytes(base64.b64decode(''.join(os.environ[variable].split()), validate=True))
    path.chmod(0o600)
PY

security cms -D -i "$SIGNING_DIR/profile.mobileprovision" > "$SIGNING_DIR/profile.plist"

python3 <<'PY'
import datetime
import json
import os
import plistlib
import uuid
from pathlib import Path

directory = Path(os.environ['SIGNING_DIR'])
profile = plistlib.loads((directory / 'profile.plist').read_bytes())
metadata = json.loads((Path(os.environ['ARTIFACT_DIR']) / 'build-metadata.json').read_text())
team = os.environ['APPLE_TEAM_ID']
entitlements = profile.get('Entitlements', {})
identifier = entitlements.get('application-identifier', '')
prefix, separator, bundle_id = identifier.partition('.')
if not separator or bundle_id != metadata['applicationId'] or prefix not in profile.get('ApplicationIdentifierPrefix', []):
    raise SystemExit('Provisioning profile does not match the iOS bundle identifier')
if team not in profile.get('TeamIdentifier', []) or entitlements.get('com.apple.developer.team-identifier') != team:
    raise SystemExit('Provisioning profile does not match APPLE_TEAM_ID')
if entitlements.get('get-task-allow') or profile.get('ProvisionsAllDevices'):
    raise SystemExit('An App Store or ad-hoc distribution profile is required')
if bool(profile.get('ProvisionedDevices')) != (metadata['profile'] == 'preview'):
    raise SystemExit('Use an App Store profile for production and an ad-hoc profile for preview')
expires = profile.get('ExpirationDate')
if not expires or expires.replace(tzinfo=datetime.timezone.utc) <= datetime.datetime.now(datetime.timezone.utc):
    raise SystemExit('Provisioning profile has expired')
profile_uuid = profile['UUID']
uuid.UUID(profile_uuid)
(directory / 'signing.json').write_text(json.dumps({'profileUUID': profile_uuid}))
options = {
    'destination': 'export',
    'method': 'app-store-connect' if metadata['profile'] == 'production' else 'ad-hoc',
    'signingStyle': 'manual',
    'signingCertificate': 'Apple Distribution',
    'teamID': team,
    'provisioningProfiles': {metadata['applicationId']: profile_uuid},
    'manageAppVersionAndBuildNumber': False,
    'stripSwiftSymbols': True
}
(directory / 'ExportOptions.plist').write_bytes(plistlib.dumps(options))
PY

security list-keychains -d user > "$SIGNING_DIR/keychains.txt"
while IFS= read -r keychain; do
  keychain="${keychain#*\"}"
  keychain="${keychain%\"*}"
  [[ -z "$keychain" ]] || ORIGINAL_KEYCHAINS+=("$keychain")
done < "$SIGNING_DIR/keychains.txt"

KEYCHAIN_PASSWORD=$(openssl rand -hex 32)
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$SIGNING_DIR/certificate.p12" -P "$P12_PASSWORD" -f pkcs12 -k "$KEYCHAIN_PATH" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
KEYCHAINS_CHANGED=true
security list-keychains -d user -s "$KEYCHAIN_PATH" "${ORIGINAL_KEYCHAINS[@]}"

PROFILE_DIRECTORY="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$PROFILE_DIRECTORY"
PROFILE_PATH="$PROFILE_DIRECTORY/$(basename "$SIGNING_DIR").mobileprovision"
cp "$SIGNING_DIR/profile.mobileprovision" "$PROFILE_PATH"

node <<'NODE'
const fs = require('fs')
const path = require('path')
const xcode = require('xcode')
const unquote = value => String(value || '').replace(/^"|"$/g, '')
const projects = fs.readdirSync('ios').filter(name => name.endsWith('.xcodeproj'))
if (projects.length !== 1) throw new Error('Expected one generated iOS application project')
const projectPath = path.join('ios', projects[0], 'project.pbxproj')
const project = xcode.project(projectPath)
project.parseSync()
const targets = Object.values(project.pbxNativeTargetSection()).filter(target =>
  unquote(target.productType) === 'com.apple.product-type.application'
)
if (targets.length !== 1) throw new Error('Expected one iOS application target')
const target = targets[0]
const scheme = unquote(target.name)
const workspace = path.join('ios', projects[0].replace(/\.xcodeproj$/, '.xcworkspace'))
if (!fs.existsSync(workspace) || !fs.existsSync(path.join('ios', projects[0], 'xcshareddata', 'xcschemes', `${scheme}.xcscheme`))) {
  throw new Error('Generated iOS workspace or shared application scheme is missing')
}
const signing = JSON.parse(fs.readFileSync(`${process.env.SIGNING_DIR}/signing.json`, 'utf8'))
const list = project.pbxXCConfigurationList()[target.buildConfigurationList]
const configurations = project.pbxXCBuildConfigurationSection()
const release = list.buildConfigurations.map(({ value }) => configurations[value]).find(config => unquote(config.name) === 'Release')
if (!release) throw new Error('Application Release configuration is missing')
Object.assign(release.buildSettings, {
  CODE_SIGN_STYLE: 'Manual',
  CODE_SIGN_IDENTITY: '"Apple Distribution"',
  DEVELOPMENT_TEAM: process.env.APPLE_TEAM_ID,
  PROVISIONING_PROFILE_SPECIFIER: signing.profileUUID
})
delete release.buildSettings.PROVISIONING_PROFILE
fs.writeFileSync(projectPath, project.writeSync())
fs.writeFileSync(`${process.env.SIGNING_DIR}/project.json`, JSON.stringify({ workspace, scheme }))
NODE

WORKSPACE_PATH=$(node -p 'require(process.env.SIGNING_DIR + "/project.json").workspace')
BUILD_SCHEME=$(node -p 'require(process.env.SIGNING_DIR + "/project.json").scheme')

xcodebuild -workspace "$WORKSPACE_PATH" \
  -scheme "$BUILD_SCHEME" \
  -archivePath "$SIGNING_DIR/Snake.xcarchive" \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  archive 2>&1 | tee "$ARTIFACT_DIR/build.log"

xcodebuild -exportArchive \
  -archivePath "$SIGNING_DIR/Snake.xcarchive" \
  -exportOptionsPlist "$SIGNING_DIR/ExportOptions.plist" \
  -exportPath "$SIGNING_DIR/export" 2>&1 | tee "$ARTIFACT_DIR/export.log"

IPAS=("$SIGNING_DIR/export"/*.ipa)
if [[ ${#IPAS[@]} != 1 || ! -f "${IPAS[0]}" ]]; then
  echo "Expected one exported IPA" >&2
  exit 1
fi
cp "${IPAS[0]}" "$ARTIFACT_DIR/Snake.ipa"
