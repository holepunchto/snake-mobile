import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const withSnakeUpdates = require('../plugins/with-snake-updates.js')
const withPearUpdates = require('pear-runtime-react-native')

const fixture = `package com.pearsnake.app

class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList = PackageList(this).packages
    )
  }
}
`

async function apply(contents, withPear = false) {
  let config = { name: 'Snake', slug: 'snake' }
  if (withPear) config = withPearUpdates(config)
  config = withSnakeUpdates(config)
  const result = await config.mods.android.mainApplication({
    ...config,
    modRequest: {},
    modResults: { contents, language: 'kt', path: 'MainApplication.kt' }
  })
  return result.modResults.contents
}

test('registers the dynamic bundle provider before ReactHost construction', async () => {
  const contents = await apply(fixture)
  assert.match(contents, /bundleFileProvider = \{ pearOtaBundle\(applicationContext\) \}/)
  assert.ok(
    contents.indexOf('SnakeUpdatesPackage.bundleFileProvider') <
      contents.indexOf('ExpoReactHostFactory.getDefaultReactHost')
  )
})

test('repeated prebuilds preserve a single provider registration', async () => {
  const once = await apply(fixture)
  assert.equal(await apply(once), once)
})

test('composes with the Pear plugin and retains its version-gated resolver', async () => {
  const once = await apply(fixture, true)
  assert.match(once, /private fun pearOtaBundle\(context: android.content.Context\)/)
  assert.match(once, /pearOtaSemVerNewer\(version, native\)/)
  assert.equal(await apply(once, true), once)
})

test('rejects an unsupported native template', async () => {
  await assert.rejects(apply('class MainApplication {}'), /Expo ReactHost initializer/)
})
