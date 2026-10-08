const appJson = require('./app.json')
const pkg = require('./package.json')

module.exports = ({ config }) => {
  const baseExpoConfig = appJson?.expo || {}
  const incoming = config || {}
  const packageVersion = String(pkg?.version || '').trim()
  const resolvedVersion =
    packageVersion || String(incoming.version || baseExpoConfig.version || '1.0.0').trim()
  const buildNumber = (process.env.BUILD_NUMBER || '').trim()

  if (buildNumber && (!/^[1-9]\d*$/.test(buildNumber) || Number(buildNumber) > 2100000000)) {
    throw new Error('BUILD_NUMBER must be an integer between 1 and 2100000000')
  }

  return {
    ...baseExpoConfig,
    ...incoming,
    version: resolvedVersion,
    ios: {
      ...baseExpoConfig.ios,
      ...incoming.ios,
      ...(process.env.IOS_BUNDLE_ID?.trim() && {
        bundleIdentifier: process.env.IOS_BUNDLE_ID.trim()
      }),
      ...(process.env.APPLE_TEAM_ID?.trim() && { appleTeamId: process.env.APPLE_TEAM_ID.trim() }),
      ...(buildNumber && { buildNumber })
    },
    android: {
      ...baseExpoConfig.android,
      ...incoming.android,
      ...(process.env.ANDROID_PACKAGE?.trim() && { package: process.env.ANDROID_PACKAGE.trim() }),
      ...(buildNumber && { versionCode: Number(buildNumber) })
    }
  }
}
