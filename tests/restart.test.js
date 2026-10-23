require('./helpers/typescript')
const test = require('brittle')
const { setImmediate: flushPromises } = require('node:timers/promises')
const createClock = require('./helpers/clock')
const { restartAfterUpdate } = require('../src/restart.ts')

function startRestart(t, reload) {
  const clock = createClock(t)
  let fallbackCalls = 0
  const cancel = restartAfterUpdate(reload, () => fallbackCalls++)
  return {
    clock,
    cancel,
    get fallbackCalls() {
      return fallbackCalls
    }
  }
}

test('missing reload requests a manual restart immediately', (t) => {
  const restart = startRestart(t, null)
  t.is(restart.fallbackCalls, 1)
})

test('rejected reload requests a manual restart', async (t) => {
  const restart = startRestart(t, () => Promise.reject(new Error('Reload unavailable')))
  await flushPromises()
  t.is(restart.fallbackCalls, 1)
})

test('thrown reload error requests a manual restart', async (t) => {
  const restart = startRestart(t, () => {
    throw new Error('Native module unavailable')
  })
  await flushPromises()
  t.is(restart.fallbackCalls, 1)
})

test('resolved reload requests a manual restart after ten seconds', async (t) => {
  let reloadCalls = 0
  const restart = startRestart(t, () => {
    reloadCalls++
    return Promise.resolve()
  })
  await flushPromises()
  t.is(reloadCalls, 1)
  restart.clock.tick(9999)
  t.is(restart.fallbackCalls, 0)
  restart.clock.tick(1)
  t.is(restart.fallbackCalls, 1)
})

test('pending reload requests a manual restart after ten seconds', async (t) => {
  const restart = startRestart(t, () => new Promise(() => {}))
  await flushPromises()
  restart.clock.tick(10000)
  t.is(restart.fallbackCalls, 1)
})

test('cancellation after reload prevents the manual restart', async (t) => {
  const restart = startRestart(t, () => Promise.resolve())
  await flushPromises()
  restart.cancel()
  restart.clock.tick(10000)
  t.is(restart.fallbackCalls, 0)
})

test('cancellation before reload prevents both callbacks', async (t) => {
  let reloadCalls = 0
  const restart = startRestart(t, () => {
    reloadCalls++
    return Promise.resolve()
  })
  restart.cancel()
  await flushPromises()
  restart.clock.tick(10000)
  t.is(reloadCalls, 0)
  t.is(restart.fallbackCalls, 0)
})

test('cancellation ignores a later reload error', async (t) => {
  let rejectReload
  const restart = startRestart(t, () => new Promise((resolve, reject) => (rejectReload = reject)))
  await flushPromises()
  restart.cancel()
  rejectReload(new Error('Reload failed after unmount'))
  await flushPromises()
  restart.clock.tick(10000)
  t.is(restart.fallbackCalls, 0)
})

test('reload error after timeout does not repeat the manual restart', async (t) => {
  let rejectReload
  const restart = startRestart(t, () => new Promise((resolve, reject) => (rejectReload = reject)))
  await flushPromises()
  restart.clock.tick(10000)
  rejectReload(new Error('Late reload failure'))
  await flushPromises()
  t.is(restart.fallbackCalls, 1)
})
