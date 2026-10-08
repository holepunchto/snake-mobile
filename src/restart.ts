export function restartAfterUpdate(
  reload: (() => Promise<void>) | null,
  onManualRestart: () => void
): () => void {
  let pending = true
  let timeout: ReturnType<typeof setTimeout> | undefined

  function cancel() {
    pending = false
    clearTimeout(timeout)
  }

  function fallback() {
    if (!pending) return
    cancel()
    onManualRestart()
  }

  if (reload) {
    timeout = setTimeout(fallback, 10000)
    Promise.resolve()
      .then(() => {
        if (pending) return reload()
      })
      .catch(fallback)
  } else {
    fallback()
  }

  return cancel
}
