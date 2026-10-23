#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

for variable in BUILD_NUMBER IOS_CERTIFICATE_BASE64 IOS_P12_PASSWORD IOS_PROVISIONING_PROFILE_BASE64 APPLE_TEAM_ID; do
  if [[ -z "${!variable:-}" ]]; then
    echo "Missing environment variable: $variable" >&2
    exit 1
  fi
done

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
test -s "$ARTIFACT_DIR/build-metadata.json"
export ARTIFACT_DIR SIGNING_DIR KEYCHAIN_PATH

node scripts/prepare-ios-signing.js

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
security import "$SIGNING_DIR/certificate.p12" -P "$IOS_P12_PASSWORD" -f pkcs12 -k "$KEYCHAIN_PATH" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
KEYCHAINS_CHANGED=true
security list-keychains -d user -s "$KEYCHAIN_PATH" "${ORIGINAL_KEYCHAINS[@]}"

PROFILE_DIRECTORY="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$PROFILE_DIRECTORY"
PROFILE_PATH="$PROFILE_DIRECTORY/$(basename "$SIGNING_DIR").mobileprovision"
cp "$SIGNING_DIR/profile.mobileprovision" "$PROFILE_PATH"

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
