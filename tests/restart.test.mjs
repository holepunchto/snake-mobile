import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { setImmediate as flushPromises } from 'node:timers/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/restart.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
})
const { restartAfterUpdate } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

function setup(t, reload) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const fallback = t.mock.fn()
  const cancel = restartAfterUpdate(reload, fallback)
  return { fallback, cancel }
}

test('unsupported restart immediately requests a full manual restart', (t) => {
  const { fallback } = setup(t, null)
  assert.equal(fallback.mock.callCount(), 1)
  t.mock.timers.tick(20000)
  assert.equal(fallback.mock.callCount(), 1)
})

test('a rejected reload requests a manual restart', async (t) => {
  const { fallback } = setup(t, () => Promise.reject(new Error('Reload unavailable')))
  await flushPromises()
  assert.equal(fallback.mock.callCount(), 1)
})

test('a synchronous reload failure requests a manual restart', async (t) => {
  const { fallback } = setup(t, () => {
    throw new Error('Native module unavailable')
  })
  await flushPromises()
  assert.equal(fallback.mock.callCount(), 1)
})

test('a resolved reload that leaves the app running eventually requests a restart', async (t) => {
  const reload = t.mock.fn(() => Promise.resolve())
  const { fallback } = setup(t, reload)
  await flushPromises()
  assert.equal(reload.mock.callCount(), 1)
  t.mock.timers.tick(9999)
  assert.equal(fallback.mock.callCount(), 0)
  t.mock.timers.tick(1)
  assert.equal(fallback.mock.callCount(), 1)
})

test('a stalled reload eventually requests a manual restart', async (t) => {
  const { fallback } = setup(t, () => new Promise(() => {}))
  await flushPromises()
  assert.equal(fallback.mock.callCount(), 0)
  t.mock.timers.tick(10000)
  assert.equal(fallback.mock.callCount(), 1)
})

test('unmounting after a successful reload cancels the fallback', async (t) => {
  const { fallback, cancel } = setup(t, () => Promise.resolve())
  await flushPromises()
  cancel()
  t.mock.timers.tick(20000)
  assert.equal(fallback.mock.callCount(), 0)
})

test('cancelling before reload starts prevents it from running', async (t) => {
  const reload = t.mock.fn(() => Promise.resolve())
  const { fallback, cancel } = setup(t, reload)
  cancel()
  await flushPromises()
  t.mock.timers.tick(20000)
  assert.equal(reload.mock.callCount(), 0)
  assert.equal(fallback.mock.callCount(), 0)
})

test('cancellation suppresses a late rejection', async (t) => {
  let rejectReload
  const { fallback, cancel } = setup(
    t,
    () => new Promise((resolve, reject) => (rejectReload = reject))
  )
  await flushPromises()
  cancel()
  rejectReload(new Error('Reload failed after unmount'))
  await flushPromises()
  t.mock.timers.tick(20000)
  assert.equal(fallback.mock.callCount(), 0)
})

test('a rejection after the timeout does not request a second manual restart', async (t) => {
  let rejectReload
  const { fallback } = setup(t, () => new Promise((resolve, reject) => (rejectReload = reject)))
  await flushPromises()
  t.mock.timers.tick(10000)
  rejectReload(new Error('Late reload failure'))
  await flushPromises()
  t.mock.timers.tick(10000)
  assert.equal(fallback.mock.callCount(), 1)
})
