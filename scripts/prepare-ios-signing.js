const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const plist = require('@expo/plist').default
const xcode = require('xcode')

const directory = process.env.SIGNING_DIR
const team = process.env.APPLE_TEAM_ID
const metadata = JSON.parse(fs.readFileSync(`${process.env.ARTIFACT_DIR}/build-metadata.json`))

for (const [variable, filename] of [
  ['IOS_CERTIFICATE_BASE64', 'certificate.p12'],
  ['IOS_PROVISIONING_PROFILE_BASE64', 'profile.mobileprovision']
]) {
  const encoded = process.env[variable].replace(/\s/g, '')
  const decoded = Buffer.from(encoded, 'base64')
  if (!decoded.length || decoded.toString('base64') !== encoded) {
    throw new Error(`${variable} must contain base64-encoded file contents`)
  }
  fs.writeFileSync(path.join(directory, filename), decoded, { mode: 0o600 })
}

const profile = plist.parse(
  execFileSync('security', ['cms', '-D', '-i', path.join(directory, 'profile.mobileprovision')], {
    encoding: 'utf8'
  })
)
const entitlements = profile.Entitlements || {}
const prefix = profile.ApplicationIdentifierPrefix?.find(
  (value) => entitlements['application-identifier'] === `${value}.${metadata.applicationId}`
)
if (!prefix) throw new Error('Provisioning profile does not match the iOS bundle identifier')
if (
  !profile.TeamIdentifier?.includes(team) ||
  entitlements['com.apple.developer.team-identifier'] !== team
) {
  throw new Error('Provisioning profile does not match APPLE_TEAM_ID')
}
if (entitlements['get-task-allow'] || profile.ProvisionsAllDevices || profile.ProvisionedDevices) {
  throw new Error('An App Store distribution profile is required')
}
if (!(new Date(profile.ExpirationDate).getTime() > Date.now())) {
  throw new Error('Provisioning profile has expired')
}
if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(profile.UUID)) {
  throw new Error('Provisioning profile UUID is invalid')
}
fs.writeFileSync(
  path.join(directory, 'ExportOptions.plist'),
  plist.build({
    destination: 'export',
    method: 'app-store-connect',
    signingStyle: 'manual',
    signingCertificate: 'Apple Distribution',
    teamID: team,
    provisioningProfiles: { [metadata.applicationId]: profile.UUID },
    manageAppVersionAndBuildNumber: false,
    stripSwiftSymbols: true
  })
)

const unquote = (value) => String(value || '').replace(/^"|"$/g, '')
const projects = fs.readdirSync('ios').filter((name) => name.endsWith('.xcodeproj'))
if (projects.length !== 1) throw new Error('Expected one generated iOS application project')
const projectPath = path.join('ios', projects[0], 'project.pbxproj')
const project = xcode.project(projectPath)
project.parseSync()
const targets = Object.values(project.pbxNativeTargetSection()).filter(
  (target) => unquote(target.productType) === 'com.apple.product-type.application'
)
if (targets.length !== 1) throw new Error('Expected one iOS application target')
const target = targets[0]
const scheme = unquote(target.name)
const workspace = path.join('ios', projects[0].replace(/\.xcodeproj$/, '.xcworkspace'))
const schemePath = path.join('ios', projects[0], 'xcshareddata', 'xcschemes', `${scheme}.xcscheme`)
if (!fs.existsSync(workspace) || !fs.existsSync(schemePath)) {
  throw new Error('Generated iOS workspace or shared application scheme is missing')
}
const list = project.pbxXCConfigurationList()[target.buildConfigurationList]
const configurations = project.pbxXCBuildConfigurationSection()
const release = list.buildConfigurations
  .map(({ value }) => configurations[value])
  .find((config) => unquote(config.name) === 'Release')
if (!release) throw new Error('Application Release configuration is missing')
Object.assign(release.buildSettings, {
  CODE_SIGN_STYLE: 'Manual',
  CODE_SIGN_IDENTITY: '"Apple Distribution"',
  DEVELOPMENT_TEAM: team,
  PROVISIONING_PROFILE_SPECIFIER: profile.UUID
})
delete release.buildSettings.PROVISIONING_PROFILE
fs.writeFileSync(projectPath, project.writeSync())
fs.writeFileSync(path.join(directory, 'project.json'), JSON.stringify({ workspace, scheme }))
