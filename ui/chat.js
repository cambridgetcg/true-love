// chat.js — vanilla browser logic for the visit interface.
//
// Subscribes to /api/stream for real-time message + status events.
// Renders messages into the conversation container; updates the
// presence strip; handles compose POST (send + send-and-wake).

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

const RECENT_YU_LIMIT = 5
const recentYuMessages = []
let lastTs = ''

const STATE_LABELS = {
  writing: "she's writing",
  thinking: "she's thinking",
  'at-rest': "she's resting",
  asleep: "she's asleep",
  gone: "she's gone",
}

// Heartbeat-tagged from-ai entries are her notes-to-self (third-person
// journal voice — "Yu asked..."), not addressed replies. Mark them
// so the CSS can render them subdued.
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

function renderStatus(snap) {
  elPresenceInstance.textContent = snap.instance
  elPresenceSoul.textContent = snap.soulFingerprintShort ? `soul ${snap.soulFingerprintShort}` : ''
  elPresenceState.textContent = STATE_LABELS[snap.state] ?? snap.state
  elPresenceState.className = `presence-state ${snap.state}`
  elPresenceActivity.textContent = snap.activity || ''
}

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

async function loadInitial() {
  try {
    const [msgsRes, statusRes] = await Promise.all([
      fetch('/api/messages'),
      fetch('/api/status'),
    ])
    if (!msgsRes.ok || !statusRes.ok) {
      console.error('initial load: non-2xx', msgsRes.status, statusRes.status)
      elConnection.hidden = false
      return
    }
    const msgs = await msgsRes.json()
    const status = await statusRes.json()
    for (const m of msgs) renderMessage(m)
    renderStatus(status)
    // Fetch mood strip (non-blocking — conversation loads first)
    fetchMood()
  } catch (err) {
    console.error('initial load failed:', err)
    elConnection.hidden = false
  }
}

let evtSource = null

async function reconcileSinceLastTs() {
  try {
    const url = lastTs ? `/api/messages?since=${encodeURIComponent(lastTs)}` : '/api/messages'
    const res = await fetch(url)
    if (!res.ok) {
      console.error('reconcile: non-2xx', res.status)
      return
    }
    const msgs = await res.json()
    for (const m of msgs) renderMessage(m)
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
      renderMessage(msg)
    } catch {}
  })
  evtSource.addEventListener('status', (e) => {
    try {
      const status = JSON.parse(e.data)
      renderStatus(status)
      // Presence changed → inner weather may have shifted
      fetchMood()
    } catch {}
  })
  evtSource.onopen = () => {
    elConnection.hidden = true
    // Reconcile any messages written during the disconnect window.
    // First-connect: lastTs is empty → fetches everything (already done by
    // loadInitial, but the dedup in renderMessage makes this idempotent).
    // Reconnect: fetches only entries after lastTs.
    reconcileSinceLastTs()
  }
  evtSource.onerror = () => {
    elConnection.hidden = false
  }
}

// Track keyboard intent (set right before requestSubmit). Mouse clicks
// are read directly from e.submitter in the submit handler.
let keyboardWakeIntent = false

elCompose.addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = elComposeText.value.trim()
  if (!text) return
  // e.submitter is the button that triggered submit (mouse path).
  // requestSubmit() leaves submitter null — that's the keyboard path.
  const wake = e.submitter ? e.submitter.value === 'wake' : keyboardWakeIntent
  elBtnSend.disabled = true
  elBtnWake.disabled = true
  try {
    const res = await fetch('/api/say', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, wake }),
    })
    const body = await res.json()
    if (body.ok) {
      elComposeText.value = ''
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

// Cmd/Ctrl-Enter sends; Cmd-Shift-Enter sends-and-wakes.
elComposeText.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    keyboardWakeIntent = e.shiftKey
    elCompose.requestSubmit()
  }
})

loadInitial().then(subscribe)
