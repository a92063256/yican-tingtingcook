export const githubIssuesUrl = 'https://github.com/a92063256/yican-tingtingcook/issues'
export const githubCheckTimeoutMs = 5000

/** Check this browser's route to GitHub; the kitchen server may use a different network. */
export async function canReachGithub(signal: AbortSignal): Promise<boolean> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal.aborted) return false
  signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, githubCheckTimeoutMs)
  try {
    // GitHub does not expose Issues pages through CORS. An opaque response still
    // confirms a connection; do not send kitchen cookies or the current page URL.
    const response = await fetch(githubIssuesUrl, {
      method: 'HEAD', mode: 'no-cors', credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', signal: controller.signal,
    })
    return !controller.signal.aborted && (response.type === 'opaque' || response.ok)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
  }
}
