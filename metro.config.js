const path = require('path')
const { getDefaultConfig: getRNConfig, mergeConfig } = require('@react-native/metro-config')
const { getDefaultConfig: getExpoConfig } = require('expo/metro-config')

module.exports = mergeConfig(getRNConfig(__dirname), getExpoConfig(__dirname), {
  watchFolders: [path.dirname(require.resolve('snake-core/package.json'))],
  resolver: {
    nodeModulesPaths: [path.join(__dirname, 'node_modules')]
  }
})
