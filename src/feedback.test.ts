import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { canReachGithub, githubCheckTimeoutMs, githubIssuesUrl } from './feedback'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('AbortSignal', class {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('accepts an opaque cross-origin response without sending cookies or a referrer', async () => {
  const fetch = vi.fn().mockResolvedValue({ type: 'opaque', ok: false, status: 0 })
  vi.stubGlobal('fetch', fetch)
  await expect(canReachGithub(new AbortController().signal)).resolves.toBe(true)
  expect(fetch).toHaveBeenCalledWith(githubIssuesUrl, expect.objectContaining({
    method: 'HEAD', mode: 'no-cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
  }))
  expect(vi.getTimerCount()).toBe(0)
})

it('offers the fallback on a network failure and clears the timeout', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  await expect(canReachGithub(new AbortController().signal)).resolves.toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it('does not accept a readable error response as available', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ type: 'basic', ok: false, status: 503 }))
  await expect(canReachGithub(new AbortController().signal)).resolves.toBe(false)
})

function stalledRequest() {
  const fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

it('aborts a stalled connection after five seconds without AbortSignal.timeout', async () => {
  const fetch = stalledRequest()
  const pending = canReachGithub(new AbortController().signal)
  await vi.advanceTimersByTimeAsync(githubCheckTimeoutMs)
  await expect(pending).resolves.toBe(false)
  expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels an in-flight check when the dialog closes', async () => {
  const fetch = stalledRequest()
  const dialog = new AbortController()
  const pending = canReachGithub(dialog.signal)
  dialog.abort()
  await expect(pending).resolves.toBe(false)
  expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('does not start a request for an already closed dialog', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  const dialog = new AbortController()
  dialog.abort()
  await expect(canReachGithub(dialog.signal)).resolves.toBe(false)
  expect(fetch).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
