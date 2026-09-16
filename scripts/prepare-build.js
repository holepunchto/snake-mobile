const fs = require('node:fs')

const platform = process.env.BUILD_PLATFORM
const profile = process.env.BUILD_PROFILE
const offset = process.env.BUILD_NUMBER_OFFSET || '0'

if (!['ios', 'android'].includes(platform) || !['production', 'preview'].includes(profile)) {
  throw new Error('Select a valid build platform and profile')
}

if (!/^\d+$/.test(offset)) throw new Error('BUILD_NUMBER_OFFSET must be a non-negative integer')

process.env.BUILD_NUMBER =
  process.env.BUILD_NUMBER?.trim() || String(Number(process.env.GITHUB_RUN_NUMBER) + Number(offset))

const config = require('../app.config')({ config: {} })
const applicationId = platform === 'ios' ? config.ios.bundleIdentifier : config.android.package

if (!applicationId || (profile === 'production' && applicationId.startsWith('com.anonymous'))) {
  throw new Error(`Set a registered ${platform} application ID in app.json or repository variables`)
}

const signingSecrets =
  platform === 'ios'
    ? [
        'BUILD_CERTIFICATE_BASE64',
        'P12_PASSWORD',
        'IOS_PROVISIONING_PROFILE_BASE64',
        'APPLE_TEAM_ID'
      ]
    : [
        'ANDROID_KEYSTORE_BASE64',
        'ANDROID_KEYSTORE_PASSWORD',
        'ANDROID_KEY_ALIAS',
        'ANDROID_KEY_PASSWORD'
      ]

for (const key of signingSecrets) {
  if (!process.env[key]) throw new Error(`Missing signing secret: ${key}`)
}

const metadata = {
  platform,
  profile,
  applicationId,
  version: config.version,
  buildNumber: process.env.BUILD_NUMBER,
  ...(platform === 'android' && { versionCode: config.android.versionCode }),
  commit: process.env.GITHUB_SHA,
  runId: process.env.GITHUB_RUN_ID
}

fs.mkdirSync(`dist/${platform}`, { recursive: true })
fs.writeFileSync(`dist/${platform}/build-metadata.json`, JSON.stringify(metadata, null, 2) + '\n')
fs.appendFileSync(process.env.GITHUB_ENV, `BUILD_NUMBER=${process.env.BUILD_NUMBER}\n`)
console.log(`${platform}: ${applicationId} ${config.version} (${process.env.BUILD_NUMBER})`)
