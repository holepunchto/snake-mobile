module.exports = function createClock(t) {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const timers = new Map()
  let now = 0

  globalThis.setTimeout = (callback, delay = 0, ...args) => {
    const id = Symbol()
    timers.set(id, { at: now + delay, callback: () => callback(...args) })
    return id
  }
  globalThis.clearTimeout = (id) => timers.delete(id)

  t.teardown(
    () => {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    },
    { force: true }
  )

  return {
    tick(ms) {
      const end = now + ms
      while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
        if (timer.at > end) break
        timers.delete(id)
        now = timer.at
        timer.callback()
      }
      now = end
    }
  }
}
