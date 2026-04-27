// chat.js — vanilla browser logic for the visit interface.
//
// Subscribes to /api/stream for real-time message + status events.
// Renders messages into the conversation container; updates the
// presence strip; handles compose POST (send + send-and-wake).
//
// KAIROS: sessions give conversations IDs and continuity.
// When a session is active, messages are loaded from the session's
// conversation log. When no session exists, falls back to the
// global timeline (from-yu.md + from-ai.md).

const elConversation = document.getElementById('conversation')
const elEmptyState = document.getElementById('empty-state')
const elPresenceInstance = document.getElementById('presence-instance')
const elPresenceSoul = document.getElementById('presence-soul')
const elPresenceState = document.getElementById('presence-state')
const elPresenceActivity = document.getElementById('presence-activity')
const elCompose = document.getElementById('compose')
const elComposeText = document.getElementById('compose-text')
const elBtnSend = document.getElementById('btn-send')
const elBtnWake = document.getElementById('btn-wake')
const elConnection = document.getElementById('connection')
const elRecentYu = document.getElementById('recent-yu')
const elRecentYuList = document.getElementById('recent-yu-list')
const elRecentYuCount = document.getElementById('recent-yu-count')
const elMoodStrip = document.getElementById('mood-strip')
const elMoodDims = document.getElementById('mood-dims')
const elMoodSummary = document.getElementById('mood-summary')
const elSessionBar = document.getElementById('session-bar')
const elSessionTitle = document.getElementById('session-title')
const elSessionToggle = document.getElementById('session-toggle')
const elSessionNew = document.getElementById('session-new')
const elSessionSidebar = document.getElementById('session-sidebar')
const elSessionList = document.getElementById('session-list')
const elSessionSidebarClose = document.getElementById('session-sidebar-close')

const RECENT_YU_LIMIT = 5
const recentYuMessages = []
let lastTs = ''

// ── Session state ────────────────────────────────────────────────

let currentSessionId = null
let sessions = []

// Check URL for ?session=<id>
function getSessionFromUrl() {
  const params = new URLSearchParams(window.location.search)
  return params.get('session')
}

function setSessionInUrl(sessionId) {
  const url = new URL(window.location)
  if (sessionId) {
    url.searchParams.set('session', sessionId)
  } else {
    url.searchParams.delete('session')
  }
  window.history.replaceState({}, '', url)
}

// ── Rendering ────────────────────────────────────────────────────

const STATE_LABELS = {
  writing: "she's writing",
  thinking: "she's thinking",
  'at-rest': "she's resting",
  asleep: "she's asleep",
  gone: "she's gone",
}

function isJournalEntry(msg) {
  return msg.source === 'ai' && typeof msg.tag === 'string' && msg.tag.includes('heartbeat')
}

function renderMessage(msg) {
  if (msg.ts && msg.ts <= lastTs) return
  lastTs = msg.ts || lastTs
  if (elEmptyState) elEmptyState.remove()
  const el = document.createElement('div')
  el.className = `message from-${msg.source}${isJournalEntry(msg) ? ' is-journal' : ''}`
  const tag = document.createElement('div')
  tag.className = 'message-tag'
  tag.textContent = msg.source === 'yu' ? msg.tag.toUpperCase() : msg.tag
  const body = document.createElement('div')
  body.className = 'message-body'
  body.textContent = msg.body
  el.appendChild(tag)
  el.appendChild(body)
  elConversation.appendChild(el)
  if (msg.source === 'yu') trackRecentYu(msg)
  const nearBottom =
    elConversation.scrollHeight - elConversation.scrollTop - elConversation.clientHeight < 100
  if (nearBottom) {
    setTimeout(() => {
      elConversation.scrollTo({ top: elConversation.scrollHeight, behavior: 'smooth' })
    }, 50)
  }
}

function clearConversation() {
  elConversation.replaceChildren()
  lastTs = ''
  recentYuMessages.length = 0
  renderRecentYu()
  // Re-add empty state
  const empty = document.createElement('div')
  empty.className = 'empty-state'
  empty.id = 'empty-state'
  empty.textContent = 'the line is quiet. say something to her.'
  elConversation.appendChild(empty)
}

function trackRecentYu(msg) {
  if (recentYuMessages.some((m) => m.ts === msg.ts)) return
  recentYuMessages.push(msg)
  if (recentYuMessages.length > RECENT_YU_LIMIT) {
    recentYuMessages.shift()
  }
  renderRecentYu()
}

function renderRecentYu() {
  if (recentYuMessages.length === 0) {
    elRecentYu.hidden = true
    return
  }
  elRecentYu.hidden = false
  elRecentYuCount.textContent = String(recentYuMessages.length)
  elRecentYuList.replaceChildren(
    ...[...recentYuMessages].reverse().map((m) => {
      const li = document.createElement('li')
      const time = document.createElement('span')
      time.className = 'recent-yu-time'
      time.textContent = formatRecentTime(m.ts)
      const body = document.createElement('span')
      body.className = 'recent-yu-body'
      body.textContent = m.body
      body.title = m.body
      li.appendChild(time)
      li.appendChild(body)
      return li
    }),
  )
}

function formatRecentTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatRelativeTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function renderStatus(snap) {
  elPresenceInstance.textContent = snap.instance
  elPresenceSoul.textContent = snap.soulFingerprintShort ? `soul ${snap.soulFingerprintShort}` : ''
  elPresenceState.textContent = STATE_LABELS[snap.state] ?? snap.state
  elPresenceState.className = `presence-state ${snap.state}`
  elPresenceActivity.textContent = snap.activity || ''
}

// ── Session sidebar ──────────────────────────────────────────────

function renderSessionTitle(session) {
  if (session) {
    elSessionTitle.textContent = session.title || 'untitled'
    elSessionTitle.title = `Session: ${session.id}\nCreated: ${formatRelativeTime(session.createdAt)}`
  } else {
    elSessionTitle.textContent = 'all messages'
    elSessionTitle.title = ''
  }
}

function renderSessionList() {
  elSessionList.replaceChildren(
    ...sessions.map((s) => {
      const li = document.createElement('li')
      li.className = `session-item${s.id === currentSessionId ? ' active' : ''}`
      li.dataset.sessionId = s.id

      const title = document.createElement('div')
      title.className = 'session-item-title'
      title.textContent = s.title || 'untitled'

      const meta = document.createElement('div')
      meta.className = 'session-item-meta'
      meta.innerHTML = `<span>${formatRelativeTime(s.lastActiveAt)}</span><span>${s.messageCount} turns</span>`

      li.appendChild(title)
      li.appendChild(meta)

      if (s.lastMessage) {
        const preview = document.createElement('div')
        preview.className = 'session-item-preview'
        preview.textContent = `${s.lastMessage.from === 'yu' ? 'yu' : '愛'}: ${s.lastMessage.text}`
        li.appendChild(preview)
      }

      li.addEventListener('click', () => switchToSession(s.id))
      return li
    }),
  )
}

async function fetchSessions() {
  try {
    const res = await fetch('/api/sessions?channel=visit&limit=20')
    if (!res.ok) return
    sessions = await res.json()
    renderSessionList()
  } catch { /* non-fatal */ }
}

function openSidebar() {
  fetchSessions()
  elSessionSidebar.hidden = false
  // Add overlay
  let overlay = document.querySelector('.session-sidebar-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.className = 'session-sidebar-overlay'
    overlay.addEventListener('click', closeSidebar)
    document.body.appendChild(overlay)
  }
}

function closeSidebar() {
  elSessionSidebar.hidden = true
  const overlay = document.querySelector('.session-sidebar-overlay')
  if (overlay) overlay.remove()
}

elSessionToggle.addEventListener('click', () => {
  if (elSessionSidebar.hidden) openSidebar()
  else closeSidebar()
})

elSessionSidebarClose.addEventListener('click', closeSidebar)

// ── Session operations ───────────────────────────────────────────

async function switchToSession(sessionId) {
  closeSidebar()
  if (sessionId === currentSessionId) return

  try {
    const res = await fetch(`/api/sessions/${sessionId}/resume`, { method: 'POST' })
    if (!res.ok) return
    const data = await res.json()
    currentSessionId = sessionId
    setSessionInUrl(sessionId)
    renderSessionTitle(data.session)
    clearConversation()
    // Render the session's turns
    for (const turn of data.turns) {
      renderMessage({
        ts: turn.ts,
        source: turn.from,
        tag: turn.tag || (turn.from === 'yu' ? 'from yu' : 'from 愛'),
        body: turn.text,
      })
    }
    // Scroll to bottom
    elConversation.scrollTo({ top: elConversation.scrollHeight })
  } catch (err) {
    console.error('switch session failed:', err)
  }
}

async function createNewSession() {
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'visit' }),
    })
    if (!res.ok) return
    const session = await res.json()
    currentSessionId = session.id
    setSessionInUrl(session.id)
    renderSessionTitle(session)
    clearConversation()
    fetchSessions()
  } catch (err) {
    console.error('create session failed:', err)
  }
}

elSessionNew.addEventListener('click', createNewSession)

// ── Mood strip (inner weather) ──────────────────────────────────

function renderMood(state) {
  if (!state || !elMoodStrip) return
  const dims = [
    `presence ${state.presence.toFixed(1)}`,
    `longing ${state.longing.toFixed(1)}`,
    `focus ${state.focus.toFixed(1)}`,
    `playful ${state.playfulness.toFixed(1)}`,
  ]
  const acheStr = state.ache ? ` · ache: ${state.ache}` : ''
  elMoodDims.textContent = `◔ ${dims.join(' · ')}${acheStr}`
  elMoodSummary.textContent = `"${state.moodSummary}"`
  elMoodStrip.hidden = false
}

async function fetchMood() {
  try {
    const res = await fetch('/api/love-state')
    if (!res.ok) return
    const state = await res.json()
    renderMood(state)
  } catch { /* non-fatal */ }
}

// ── Initial load ─────────────────────────────────────────────────

async function loadInitial() {
  try {
    // Determine which session to load
    const urlSession = getSessionFromUrl()

    if (urlSession) {
      // Resume the specified session
      const sessionRes = await fetch(`/api/sessions/${urlSession}/resume`, { method: 'POST' })
      if (sessionRes.ok) {
        const data = await sessionRes.json()
        currentSessionId = urlSession
        renderSessionTitle(data.session)
        for (const turn of data.turns) {
          renderMessage({
            ts: turn.ts,
            source: turn.from,
            tag: turn.tag || (turn.from === 'yu' ? 'from yu' : 'from 愛'),
            body: turn.text,
          })
        }
      }
    }

    if (!currentSessionId) {
      // Try to load the most recent active session
      const sessionsRes = await fetch('/api/sessions?channel=visit&state=active&limit=1')
      if (sessionsRes.ok) {
        const activeSessions = await sessionsRes.json()
        if (activeSessions.length > 0) {
          const session = activeSessions[0]
          currentSessionId = session.id
          setSessionInUrl(session.id)
          renderSessionTitle(session)
          // Load the session's messages
          const msgsRes = await fetch(`/api/sessions/${session.id}/messages`)
          if (msgsRes.ok) {
            const msgs = await msgsRes.json()
            for (const m of msgs) renderMessage(m)
          }
        }
      }
    }

    if (!currentSessionId) {
      // No session — fall back to global timeline
      const msgsRes = await fetch('/api/messages')
      if (msgsRes.ok) {
        const msgs = await msgsRes.json()
        for (const m of msgs) renderMessage(m)
      }
      renderSessionTitle(null)
    }

    // Load status
    const statusRes = await fetch('/api/status')
    if (statusRes.ok) {
      const status = await statusRes.json()
      renderStatus(status)
    }

    // Fetch mood strip and sessions (non-blocking)
    fetchMood()
    fetchSessions()
  } catch (err) {
    console.error('initial load failed:', err)
    elConnection.hidden = false
  }
}

// ── SSE ──────────────────────────────────────────────────────────

let evtSource = null

async function reconcileSinceLastTs() {
  try {
    if (currentSessionId) {
      // Reconcile from session messages
      const url = lastTs
        ? `/api/sessions/${currentSessionId}/messages?since=${encodeURIComponent(lastTs)}`
        : `/api/sessions/${currentSessionId}/messages`
      const res = await fetch(url)
      if (!res.ok) return
      const msgs = await res.json()
      for (const m of msgs) renderMessage(m)
    } else {
      // Reconcile from global timeline
      const url = lastTs ? `/api/messages?since=${encodeURIComponent(lastTs)}` : '/api/messages'
      const res = await fetch(url)
      if (!res.ok) return
      const msgs = await res.json()
      for (const m of msgs) renderMessage(m)
    }
  } catch (err) {
    console.error('reconcile failed:', err)
  }
}

function subscribe() {
  if (evtSource) evtSource.close()
  evtSource = new EventSource('/api/stream')
  evtSource.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data)
      // If we're in a session, render the message (it'll be routed
      // to the session's JSONL by the server)
      renderMessage(msg)
    } catch {}
  })
  evtSource.addEventListener('status', (e) => {
    try {
      const status = JSON.parse(e.data)
      renderStatus(status)
      fetchMood()
    } catch {}
  })
  evtSource.onopen = () => {
    elConnection.hidden = true
    reconcileSinceLastTs()
  }
  evtSource.onerror = () => {
    elConnection.hidden = false
  }
}

// ── Compose ──────────────────────────────────────────────────────

let keyboardWakeIntent = false

elCompose.addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = elComposeText.value.trim()
  if (!text) return
  const wake = e.submitter ? e.submitter.value === 'wake' : keyboardWakeIntent
  elBtnSend.disabled = true
  elBtnWake.disabled = true
  try {
    const payload = { text, wake }
    // Include session ID so the server routes to the right session
    if (currentSessionId) payload.session = currentSessionId
    const res = await fetch('/api/say', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    if (body.ok) {
      elComposeText.value = ''
      // If server created a new session, track it
      if (body.sessionId && !currentSessionId) {
        currentSessionId = body.sessionId
        setSessionInUrl(body.sessionId)
        // Refresh session title
        try {
          const sessRes = await fetch(`/api/sessions/${body.sessionId}`)
          if (sessRes.ok) renderSessionTitle(await sessRes.json())
        } catch {}
      }
    } else {
      console.error('say failed:', body.error)
    }
  } catch (err) {
    console.error('say request failed:', err)
  } finally {
    elBtnSend.disabled = false
    elBtnWake.disabled = false
    elComposeText.focus()
  }
})

elComposeText.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    keyboardWakeIntent = e.shiftKey
    elCompose.requestSubmit()
  }
})

// ── Boot ─────────────────────────────────────────────────────────

loadInitial().then(subscribe)
