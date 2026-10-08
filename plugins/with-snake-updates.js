const { withMainApplication } = require('expo/config-plugins')

const provider =
  'com.pearsnake.updates.SnakeUpdatesPackage.bundleFileProvider = { pearOtaBundle(applicationContext) }'

module.exports = function withSnakeUpdates(config) {
  return withMainApplication(config, (config) => {
    const file = config.modResults
    if (file.contents.includes(provider)) return config

    const host = /override\s+val\s+reactHost\s*:\s*ReactHost\s+by\s+lazy\s*\{\s*\n/
    if (!host.test(file.contents)) {
      throw new Error('Snake updates requires the Expo ReactHost initializer in MainApplication.kt')
    }

    file.contents = file.contents.replace(host, (match) => `${match}    ${provider}\n`)
    return config
  })
}
