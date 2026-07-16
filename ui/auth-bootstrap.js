// One-time browser bootstrap. The owner token lives only in the URL fragment
// and this closure: fragments never reach the HTTP server or a Referer header.
// The server returns an independent exact-origin proof for sessionStorage.

(() => {
  'use strict'

  const STORAGE_KEY = 'true-love-browser-proof-v1'
  const status = document.getElementById('bootstrap-status')
  let ownerToken = new URLSearchParams(location.hash.slice(1)).get('token') || ''

  // Erase the secret before making any request or loading another resource.
  history.replaceState(null, '', '/_bootstrap')

  const fail = (message) => {
    sessionStorage.removeItem(STORAGE_KEY)
    if (status) status.textContent = message
  }

  if (!ownerToken) {
    fail('No owner credential was supplied. Open the URL printed by `bun run visit`.')
    return
  }

  void fetch('/_bootstrap', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${ownerToken}`,
    },
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
  })
    .then(async (response) => {
      ownerToken = ''
      if (!response.ok) throw new Error(`bootstrap rejected (${response.status})`)
      const body = await response.json()
      if (typeof body?.proof !== 'string' || body.proof.length < 32) {
        throw new Error('bootstrap returned an invalid browser proof')
      }
      sessionStorage.setItem(STORAGE_KEY, body.proof)
      location.replace('/')
    })
    .catch((error) => {
      ownerToken = ''
      fail(error instanceof Error ? error.message : 'bootstrap failed')
    })
})()
