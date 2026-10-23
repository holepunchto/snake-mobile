const fs = require('node:fs')
const { version } = require('../package.json')

const platform = process.env.BUILD_PLATFORM
const run = process.env.GITHUB_RUN_NUMBER
const attempt = process.env.GITHUB_RUN_ATTEMPT

if (!['ios', 'android'].includes(platform)) throw new Error('Select ios or android')
if (!/^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.test(version)) {
  throw new Error('package.json version must be major.minor.patch with components from 0 to 999')
}
if (!/^[1-9]\d*$/.test(run) || !/^[1-9]\d?$/.test(attempt)) {
  throw new Error('GITHUB_RUN_NUMBER must be positive and GITHUB_RUN_ATTEMPT must be from 1 to 99')
}
const buildNumber = Number(run) * 100 + Number(attempt)
if (!Number.isSafeInteger(buildNumber) || buildNumber > 2100000000) {
  throw new Error('Build number exceeds the Android version code limit')
}
process.env.BUILD_NUMBER = String(buildNumber)

const config = require('../app.config')({ config: {} })
const applicationId = platform === 'ios' ? config.ios.bundleIdentifier : config.android.package

if (!applicationId || applicationId.startsWith('com.anonymous.')) {
  throw new Error(`Set a registered ${platform} application ID in app.json`)
}

const signingSecrets =
  platform === 'ios'
    ? [
        'IOS_CERTIFICATE_BASE64',
        'IOS_P12_PASSWORD',
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
  applicationId,
  version,
  buildNumber: String(buildNumber),
  buildLabel: `${version
    .split('.')
    .map((part) => part.padStart(3, '0'))
    .join('.')}-${run.padStart(8, '0')}.${attempt.padStart(2, '0')}`,
  ...(platform === 'android' && { versionCode: config.android.versionCode }),
  repository: process.env.SOURCE_REPOSITORY,
  ref: process.env.SOURCE_REF,
  commit: process.env.SOURCE_COMMIT,
  buildRepository: process.env.GITHUB_REPOSITORY,
  runId: process.env.GITHUB_RUN_ID
}

fs.mkdirSync(`dist/${platform}`, { recursive: true })
fs.writeFileSync(`dist/${platform}/build-metadata.json`, JSON.stringify(metadata, null, 2) + '\n')
fs.appendFileSync(process.env.GITHUB_ENV, `BUILD_NUMBER=${process.env.BUILD_NUMBER}\n`)
console.log(`${platform}: ${applicationId} ${config.version} (${process.env.BUILD_NUMBER})`)
