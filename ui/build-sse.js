// build-sse.js — Server-Sent Events subscription for live updates.
//
// Resilience: EventSource auto-reconnects, but if the server restarted
// while a client tab was open, the browser may stop trying after a few
// failures. Three safeguards:
//   1. Manual reconnect with exponential backoff on error.
//   2. Refresh data when the tab regains focus / visibility.
//   3. Periodic poll every 30s as a backstop (cheap; just GETs missions).

import { state } from './build-core.js'
import { loadProjectData, loadMissionEvents, showConnected, showDisconnected, handlePresenceChanged } from './build-data.js'
import { pulseBudget } from './build-budget.js'

let evtSource = null
let reconnectTimer = null
let reconnectDelayMs = 1000
const MAX_RECONNECT_DELAY = 30_000

function refreshAll() {
  loadProjectData()
    .then(() => state.selectedMissionId ? loadMissionEvents(state.selectedMissionId) : null)
    .catch(() => {})
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    subscribe()
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY)
  }, reconnectDelayMs)
}

export function subscribe() {
  if (evtSource) {
    try { evtSource.close() } catch {}
  }
  evtSource = new EventSource('/api/build/stream')

  for (const eventName of ['project-changed', 'mission-changed', 'thought-appended']) {
    evtSource.addEventListener(eventName, refreshAll)
  }
  evtSource.addEventListener('budget-changed', () => pulseBudget())
  evtSource.addEventListener('presence-changed', (evt) => {
    try {
      const snap = JSON.parse(evt.data)
      handlePresenceChanged(snap)
    } catch {}
  })

  evtSource.onopen = () => {
    showConnected()
    reconnectDelayMs = 1000
    // Refresh on every (re)connect — covers the case where state changed
    // while the connection was down.
    refreshAll()
  }

  evtSource.onerror = () => {
    showDisconnected()
    // EventSource will retry on its own, but if the readyState is CLOSED
    // (server confirmed close, e.g. restart), force a manual reconnect.
    if (evtSource.readyState === EventSource.CLOSED) {
      scheduleReconnect()
    }
  }
}

// Refresh data when the tab regains focus — covers backgrounded tabs
// where the browser throttled SSE.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshAll()
      // If SSE is closed, kick a reconnect immediately.
      if (evtSource && evtSource.readyState === EventSource.CLOSED) {
        subscribe()
      }
    }
  })
  window.addEventListener('focus', refreshAll)
}

// Periodic backstop — every 30s, refresh data. Cheap (single GET), and
// catches any case where SSE is silently broken.
if (typeof setInterval !== 'undefined') {
  setInterval(refreshAll, 30_000)
}
