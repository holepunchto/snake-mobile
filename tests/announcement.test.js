const test = require('brittle')
const EventEmitter = require('bare-events')
const Module = require('bare-module')
const path = require('bare-path')
const createClock = require('./helpers/clock')

const workerURL = new URL('file://' + require.resolve('../workers/main.js'))
const flushPromises = () => new Promise((resolve) => setImmediate(resolve))
const firstTopic = 'ab'.repeat(32)
const secondTopic = 'cd'.repeat(32)
const id = '020202'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((accept, fail) => {
    resolve = accept
    reject = fail
  })
  return { promise, resolve, reject }
}

function setup(t) {
  const clock = createClock(t)
  const messages = []
  const swarms = []
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
      swarms.push(this)
    }

    join() {
      const discovery = {
        ...deferred(),
        refreshes: [],
        flushed() {
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

    leave() {
      return this.leaving?.promise
    }

    destroy() {}
  }

  class PearRuntime extends EventEmitter {
    constructor() {
      super()
      this.updater = new EventEmitter()
    }

    close() {}
  }

  const modules = {
    'pear-mobile': PearRuntime,
    hyperswarm: Hyperswarm,
    corestore: class {
      close() {}
    },
    'graceful-goodbye': (callback) => (onShutdown = callback),
    'framed-stream': FramedStream,
    'hypercore-crypto': { randomBytes: (size) => Buffer.alloc(size, 3) },
    b4a: require('b4a'),
    'bare-path': path,
    'bare-storage': { persistent: () => '/test' },
    'which-runtime': { isBareKit: false }
  }

  const argv = Bare.argv.slice()
  Bare.argv.splice(0, Bare.argv.length, 'bare', 'main.js', 'false')
  try {
    Module.loadSync(workerURL, { protocol: module.protocol, builtins: modules })
  } finally {
    Bare.argv.splice(0, Bare.argv.length, ...argv)
  }

  const swarm = swarms[1]

  async function command(message) {
    pipe.emit('data', Buffer.from(JSON.stringify(message)))
    await flushPromises()
  }

  return {
    messages,
    swarm,
    command,
    async join(topic = firstTopic) {
      await command({ type: 'join', topic })
      return swarm.discoveries.at(-1)
    },
    async tick(milliseconds) {
      clock.tick(milliseconds)
      await flushPromises()
    },
    async shutdown() {
      await onShutdown()
      await flushPromises()
    }
  }
}

async function resolve(attempt, value) {
  attempt.resolve(value)
  await flushPromises()
}

async function reject(attempt) {
  attempt.reject(new Error('Discovery unavailable'))
  await flushPromises()
}

test('a new game starts before discovery finishes', async (t) => {
  const worker = setup(t)
  await worker.join(null)

  t.alike(worker.messages, [{ type: 'ready', id, topic: '03'.repeat(32) }])
})

test('a successful announcement reports success and stops retrying', async (t) => {
  const worker = setup(t)
  const discovery = await worker.join()

  await resolve(discovery, true)
  await worker.tick(30000)

  t.alike(worker.messages, [
    { type: 'ready', id, topic: firstTopic },
    { type: 'flushed', topic: firstTopic }
  ])
  t.is(discovery.refreshes.length, 0)
})

test('failed announcements wait five seconds between retries', async (t) => {
  const worker = setup(t)
  const discovery = await worker.join()

  await resolve(discovery, false)
  await worker.tick(4999)
  t.is(discovery.refreshes.length, 0)
  await worker.tick(1)
  t.is(discovery.refreshes.length, 1)

  await resolve(discovery.refreshes[0], false)
  await worker.tick(4999)
  t.is(discovery.refreshes.length, 1)
  await worker.tick(1)
  t.is(discovery.refreshes.length, 2)
  t.alike(worker.messages, [{ type: 'ready', id, topic: firstTopic }])
})

test('rejected announcements retry until a refresh succeeds', async (t) => {
  const worker = setup(t)
  const discovery = await worker.join()

  await reject(discovery)
  await worker.tick(5000)
  await reject(discovery.refreshes[0])
  await worker.tick(5000)
  await resolve(discovery.refreshes[1])
  await worker.tick(30000)

  t.alike(worker.messages, [
    { type: 'ready', id, topic: firstTopic },
    { type: 'flushed', topic: firstTopic }
  ])
  t.is(discovery.refreshes.length, 2)
})

test('leaving cancels a scheduled retry', async (t) => {
  const worker = setup(t)
  const discovery = await worker.join()

  await resolve(discovery, false)
  await worker.command({ type: 'leave' })
  await worker.tick(5000)

  t.is(discovery.refreshes.length, 0)
})

test('shutdown cancels a scheduled retry', async (t) => {
  const worker = setup(t)
  const discovery = await worker.join()

  await resolve(discovery, false)
  await worker.shutdown()
  await worker.tick(5000)

  t.is(discovery.refreshes.length, 0)
})

test('leaving ignores a pending announcement result', async (t) => {
  const worker = setup(t)
  const discovery = await worker.join()

  await worker.command({ type: 'leave' })
  await resolve(discovery, true)

  t.alike(worker.messages, [{ type: 'ready', id, topic: firstTopic }])
})

test('shutdown ignores a pending refresh failure', async (t) => {
  const worker = setup(t)
  const discovery = await worker.join()

  await resolve(discovery, false)
  await worker.tick(5000)
  await worker.shutdown()
  await reject(discovery.refreshes[0])
  await worker.tick(5000)

  t.is(discovery.refreshes.length, 1)
  t.alike(worker.messages, [{ type: 'ready', id, topic: firstTopic }])
})

test('joining another game ignores the previous announcement result', async (t) => {
  const worker = setup(t)
  const previous = await worker.join()
  const current = await worker.join(secondTopic)

  await resolve(previous, true)
  t.alike(worker.messages, [
    { type: 'ready', id, topic: firstTopic },
    { type: 'ready', id, topic: secondTopic }
  ])

  await resolve(current, true)
  t.alike(worker.messages.at(-1), { type: 'flushed', topic: secondTopic })
})

test('rejoining the same game ignores the previous refresh result', async (t) => {
  const worker = setup(t)
  const previous = await worker.join()
  await resolve(previous, false)
  await worker.tick(5000)
  const current = await worker.join()

  await resolve(previous.refreshes[0], true)
  t.alike(worker.messages, [
    { type: 'ready', id, topic: firstTopic },
    { type: 'ready', id, topic: firstTopic }
  ])

  await resolve(current, true)
  t.alike(worker.messages.at(-1), { type: 'flushed', topic: firstTopic })
})

test('joining another game cancels the previous retry', async (t) => {
  const worker = setup(t)
  const previous = await worker.join()

  await resolve(previous, false)
  const current = await worker.join(secondTopic)
  await worker.tick(5000)

  t.is(previous.refreshes.length, 0)
  t.is(current.refreshes.length, 0)
})

test('a new game waits for the previous leave to finish', async (t) => {
  const worker = setup(t)
  await worker.join()
  worker.swarm.leaving = deferred()

  await worker.command({ type: 'leave' })
  await worker.command({ type: 'join', topic: secondTopic })
  t.is(worker.swarm.discoveries.length, 1)

  await resolve(worker.swarm.leaving)
  t.is(worker.swarm.discoveries.length, 2)
  t.alike(worker.messages.at(-1), { type: 'ready', id, topic: secondTopic })
})
