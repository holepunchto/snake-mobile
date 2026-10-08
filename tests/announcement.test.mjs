import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { setImmediate as flushPromises } from 'node:timers/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../workers/main.js', import.meta.url), 'utf8')
const firstTopic = 'ab'.repeat(32)
const secondTopic = 'cd'.repeat(32)
const id = '020202'
const outcomes = [
  { name: 'success', value: true },
  { name: 'failure', value: false },
  { name: 'rejection', error: new Error('Discovery unavailable') }
]

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

function setup() {
  const messages = []
  const swarms = []
  const timers = new Set()
  let now = 0
  let pipe
  let onShutdown

  class FramedStream extends EventEmitter {
    constructor() {
      super()
      pipe = this
    }

    write(data) {
      messages.push(JSON.parse(data.toString()))
    }
  }

  class Hyperswarm extends EventEmitter {
    constructor() {
      super()
      this.connections = new Set()
      this.keyPair = { publicKey: Buffer.alloc(32, 2) }
      this.discoveries = []
      this.left = []
      swarms.push(this)
    }

    join(topic, options) {
      const discovery = {
        ...deferred(),
        topic,
        options,
        flushCalls: 0,
        refreshes: [],
        flushed() {
          this.flushCalls++
          return this.promise
        },
        refresh() {
          const attempt = deferred()
          this.refreshes.push(attempt)
          return attempt.promise
        }
      }
      this.discoveries.push(discovery)
      return discovery
    }

    leave(topic) {
      this.left.push(topic)
      return Promise.resolve()
    }

    destroy() {
      return Promise.resolve()
    }
  }

  class PearRuntime extends EventEmitter {
    constructor() {
      super()
      this.updater = new EventEmitter()
    }

    close() {
      return Promise.resolve()
    }
  }

  const modules = {
    'pear-mobile': PearRuntime,
    hyperswarm: Hyperswarm,
    corestore: class {
      close() {
        return Promise.resolve()
      }
    },
    'graceful-goodbye': (callback) => (onShutdown = callback),
    'framed-stream': FramedStream,
    'hypercore-crypto': { randomBytes: (size) => Buffer.alloc(size, 3) },
    b4a: { from: Buffer.from, toString: (buffer, encoding) => buffer.toString(encoding) },
    'bare-path': path,
    'bare-storage': { persistent: () => '/test' },
    'which-runtime': { isBareKit: true }
  }

  vm.runInNewContext(source, {
    Buffer,
    Bare: { argv: ['false'], IPC: {} },
    console,
    setTimeout(callback, delay) {
      const timer = { callback, due: now + delay }
      timers.add(timer)
      return timer
    },
    clearTimeout(timer) {
      timers.delete(timer)
    },
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`)
      return modules[name]
    }
  })

  const gameSwarm = swarms[1]

  async function command(message) {
    pipe.emit('data', Buffer.from(JSON.stringify(message)))
    await flushPromises()
  }

  return {
    messages,
    gameSwarm,
    command,
    timers,
    async join(topic) {
      await command({ type: 'join', topic })
      return gameSwarm.discoveries.at(-1)
    },
    async tick(milliseconds) {
      now += milliseconds
      for (const timer of [...timers]) {
        if (timer.due > now) continue
        timers.delete(timer)
        timer.callback()
      }
      await flushPromises()
    },
    async shutdown() {
      await onShutdown()
      await flushPromises()
    }
  }
}

async function settle(discovery, outcome) {
  if (outcome.error) discovery.reject(outcome.error)
  else discovery.resolve(outcome.value)
  await flushPromises()
}

test('a new game starts while its announcement remains pending', async () => {
  const worker = setup()
  const discovery = await worker.join()
  const topic = '03'.repeat(32)

  assert.deepEqual(worker.messages, [{ type: 'ready', id, topic }])
  assert.equal(discovery.topic.toString('hex'), topic)
  assert.equal(discovery.options.client, true)
  assert.equal(discovery.options.server, true)
  await worker.tick(30000)
  assert.equal(discovery.flushCalls, 1)
  assert.equal(discovery.refreshes.length, 0)
  assert.equal(worker.timers.size, 0)
  assert.deepEqual(worker.messages, [{ type: 'ready', id, topic }])
})

test('a successful initial announcement reports success without scheduling retries', async () => {
  const worker = setup()
  const discovery = await worker.join(firstTopic)

  await settle(discovery, outcomes[0])
  assert.deepEqual(worker.messages, [
    { type: 'ready', id, topic: firstTopic },
    { type: 'flushed', topic: firstTopic }
  ])
  await worker.tick(30000)
  assert.equal(discovery.flushCalls, 1)
  assert.equal(discovery.refreshes.length, 0)
  assert.equal(worker.timers.size, 0)
})

for (const outcome of outcomes.slice(1)) {
  test(`initial announcement ${outcome.name} starts one refresh after five seconds`, async () => {
    const worker = setup()
    const discovery = await worker.join(firstTopic)

    await settle(discovery, outcome)
    assert.deepEqual(worker.messages, [{ type: 'ready', id, topic: firstTopic }])
    assert.equal(worker.timers.size, 1)
    await worker.tick(4999)
    assert.equal(discovery.refreshes.length, 0)
    await worker.tick(1)
    assert.equal(discovery.refreshes.length, 1)
    assert.equal(worker.timers.size, 0)

    await worker.tick(30000)
    assert.equal(discovery.flushCalls, 1)
    assert.equal(discovery.refreshes.length, 1)
    assert.equal(worker.timers.size, 0)
    assert.deepEqual(worker.messages, [{ type: 'ready', id, topic: firstTopic }])
  })

  test(`refresh ${outcome.name} waits another five seconds before retrying`, async () => {
    const worker = setup()
    const discovery = await worker.join(firstTopic)

    await settle(discovery, outcome)
    await worker.tick(5000)
    await settle(discovery.refreshes[0], outcome)
    assert.equal(worker.timers.size, 1)
    await worker.tick(4999)
    assert.equal(discovery.refreshes.length, 1)
    await worker.tick(1)
    assert.equal(discovery.refreshes.length, 2)
    assert.equal(discovery.flushCalls, 1)
    assert.deepEqual(worker.messages, [{ type: 'ready', id, topic: firstTopic }])
  })
}

for (const value of [true, undefined]) {
  test(`refresh resolving ${value} reports success and stops retrying`, async () => {
    const worker = setup()
    const discovery = await worker.join(firstTopic)

    await settle(discovery, outcomes[1])
    await worker.tick(5000)
    await settle(discovery.refreshes[0], { value })
    await worker.tick(30000)
    assert.deepEqual(worker.messages, [
      { type: 'ready', id, topic: firstTopic },
      { type: 'flushed', topic: firstTopic }
    ])
    assert.equal(discovery.flushCalls, 1)
    assert.equal(discovery.refreshes.length, 1)
    assert.equal(worker.timers.size, 0)
  })
}

for (const action of ['leave', 'shutdown']) {
  const stop = (worker) =>
    action === 'leave' ? worker.command({ type: 'leave' }) : worker.shutdown()

  test(`${action} cancels a scheduled announcement retry`, async () => {
    const worker = setup()
    const discovery = await worker.join(firstTopic)

    await settle(discovery, outcomes[1])
    assert.equal(worker.timers.size, 1)
    await stop(worker)
    assert.equal(worker.timers.size, 0)
    await worker.tick(5000)
    assert.equal(discovery.refreshes.length, 0)
    assert.deepEqual(worker.messages, [{ type: 'ready', id, topic: firstTopic }])
  })

  for (const outcome of outcomes) {
    for (const retry of [false, true]) {
      const attempt = retry ? 'refresh' : 'initial announcement'

      test(`${action} ignores a pending ${attempt}'s ${outcome.name}`, async () => {
        const worker = setup()
        const discovery = await worker.join(firstTopic)
        let pending = discovery

        if (retry) {
          await settle(discovery, outcomes[1])
          await worker.tick(5000)
          pending = discovery.refreshes[0]
        }

        await stop(worker)
        await settle(pending, outcome)
        assert.equal(worker.timers.size, 0)
        assert.deepEqual(worker.messages, [{ type: 'ready', id, topic: firstTopic }])
      })
    }
  }
}

for (const outcome of outcomes) {
  for (const topic of [firstTopic, secondTopic]) {
    const kind = topic === firstTopic ? 'same' : 'different'

    for (const retry of [false, true]) {
      const attempt = retry ? 'refresh' : 'initial announcement'

      test(`rejoining the ${kind} topic ignores the previous ${attempt}'s ${outcome.name}`, async () => {
        const worker = setup()
        const previous = await worker.join(firstTopic)
        let pending = previous

        if (retry) {
          await settle(previous, outcomes[1])
          await worker.tick(5000)
          pending = previous.refreshes[0]
        }

        const current = await worker.join(topic)
        const ready = [
          { type: 'ready', id, topic: firstTopic },
          { type: 'ready', id, topic }
        ]

        assert.equal(worker.gameSwarm.discoveries.length, 2)
        assert.deepEqual(worker.gameSwarm.left, [previous.topic])
        assert.notEqual(previous.topic, current.topic)
        await settle(pending, outcome)
        assert.equal(worker.timers.size, 0)
        assert.deepEqual(worker.messages, ready)

        await settle(current, outcomes[0])
        assert.deepEqual(worker.messages, [...ready, { type: 'flushed', topic }])
      })
    }
  }
}

test('rejoining cancels the previous topic’s scheduled retry', async () => {
  const worker = setup()
  const previous = await worker.join(firstTopic)

  await settle(previous, outcomes[1])
  const current = await worker.join(firstTopic)
  await worker.tick(5000)
  assert.equal(previous.refreshes.length, 0)
  assert.equal(current.refreshes.length, 0)
  assert.equal(worker.timers.size, 0)
})
