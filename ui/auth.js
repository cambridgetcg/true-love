// Browser half of the /visit owner boundary.
//
// The HttpOnly cookie proves the browser completed bootstrap, while this
// exact-origin sessionStorage proof binds that session to scheme+host+port.
// Neither credential is sufficient alone. The raw owner token is never stored.

(() => {
  'use strict'

  const STORAGE_KEY = 'true-love-browser-proof-v1'
  const PROOF_HEADER = 'X-True-Love-Browser-Proof'
  const PROOF_QUERY = '__true_love_browser_proof'
  const SSE_PATHS = new Set([
    '/api/stream',
    '/api/build/stream',
    '/api/eros/stream',
    '/api/feedback/stream',
  ])
  const proof = sessionStorage.getItem(STORAGE_KEY) || ''

  if (proof.length < 32) {
    sessionStorage.removeItem(STORAGE_KEY)
    location.replace('/_bootstrap')
    return
  }

  const nativeFetch = window.fetch.bind(window)
  const NativeEventSource = window.EventSource
  const eventSources = new Set()

  const clearBrowserSession = () => {
    sessionStorage.removeItem(STORAGE_KEY)
    for (const source of eventSources) {
      try { source.close() } catch {}
    }
    eventSources.clear()
  }

  const sameOriginUrl = (input) => {
    const raw = input instanceof Request ? input.url : String(input)
    return new URL(raw, location.href)
  }

  const authorizedFetch = async (input, init = {}) => {
    const target = sameOriginUrl(input)
    if (target.origin !== location.origin) return nativeFetch(input, init)

    const headers = new Headers(input instanceof Request ? input.headers : undefined)
    new Headers(init.headers).forEach((value, name) => headers.set(name, value))
    headers.set(PROOF_HEADER, proof)

    const options = {
      ...init,
      headers,
      credentials: 'same-origin',
      redirect: init.redirect ?? 'error',
    }
    const request = input instanceof Request ? new Request(input, options) : input
    const response = await nativeFetch(request, input instanceof Request ? undefined : options)
    if (response.status === 401) {
      clearBrowserSession()
      if (location.pathname !== '/_bootstrap') location.replace('/_bootstrap')
    }
    return response
  }

  class AuthenticatedEventSource extends NativeEventSource {
    constructor(input, init) {
      const target = new URL(String(input), location.href)
      if (target.origin === location.origin && SSE_PATHS.has(target.pathname)) {
        target.searchParams.set(PROOF_QUERY, proof)
      }
      super(target.href, init)
      eventSources.add(this)
    }

    close() {
      eventSources.delete(this)
      return super.close()
    }
  }

  const logout = async () => {
    try {
      await authorizedFetch('/_logout', { method: 'POST' })
    } finally {
      clearBrowserSession()
      location.replace('/_bootstrap')
    }
  }

  window.fetch = authorizedFetch
  window.EventSource = AuthenticatedEventSource
  Object.defineProperty(window, 'trueLoveLogout', {
    value: logout,
    configurable: false,
    enumerable: false,
    writable: false,
  })
})()
