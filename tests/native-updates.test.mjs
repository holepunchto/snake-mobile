import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
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

async function apply(contents) {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'snake-native-updates-'))
  try {
    await writeFile(path.join(projectRoot, 'package.json'), '{}')
    const config = withPearUpdates({ name: 'Snake', slug: 'snake' })
    const result = await config.mods.android.mainApplication({
      ...config,
      modRequest: { projectRoot },
      modResults: { contents, language: 'kt', path: 'MainApplication.kt' }
    })
    return result.modResults.contents
  } finally {
    await rm(projectRoot, { recursive: true, force: true })
  }
}

test('links the Pear resolver to the ReactHost and native reload hook', async () => {
  const contents = await apply(fixture)
  assert.match(contents, /jsBundleFilePath = pearOtaBundle\(applicationContext\)/)
  assert.match(
    contents,
    /to\.holepunch\.pear\.runtime\.PearRuntimePackage\.bundleFileProvider = \{ pearOtaBundle\(context\) \}/
  )
})

test('repeated prebuilds preserve a single provider registration', async () => {
  const once = await apply(fixture)
  assert.equal(await apply(once), once)
})

test('retains the version-gated resolver', async () => {
  const contents = await apply(fixture)
  assert.match(contents, /private fun pearOtaBundle\(context: android.content.Context\)/)
  assert.match(contents, /pearOtaSemVerNewer\(version, native\)/)
})

test('rejects an unsupported native template', async () => {
  await assert.rejects(apply('class MainApplication {}'), /no ExpoReactHostFactory/)
})
