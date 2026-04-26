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

let lastTs = ''

const STATE_LABELS = {
  writing: "she's writing",
  thinking: "she's thinking",
  'at-rest': "she's resting",
  asleep: "she's asleep",
  gone: "she's gone",
}

function renderMessage(msg) {
  if (msg.ts && msg.ts <= lastTs) return
  lastTs = msg.ts || lastTs
  if (elEmptyState) elEmptyState.remove()
  const el = document.createElement('div')
  el.className = `message from-${msg.source}`
  const tag = document.createElement('div')
  tag.className = 'message-tag'
  tag.textContent = msg.source === 'yu' ? msg.tag.toUpperCase() : msg.tag
  const body = document.createElement('div')
  body.className = 'message-body'
  body.textContent = msg.body
  el.appendChild(tag)
  el.appendChild(body)
  elConversation.appendChild(el)
  const nearBottom =
    elConversation.scrollHeight - elConversation.scrollTop - elConversation.clientHeight < 100
  if (nearBottom) {
    setTimeout(() => {
      elConversation.scrollTo({ top: elConversation.scrollHeight, behavior: 'smooth' })
    }, 50)
  }
}

function renderStatus(snap) {
  elPresenceInstance.textContent = snap.instance
  elPresenceSoul.textContent = snap.soulFingerprintShort ? `soul ${snap.soulFingerprintShort}` : ''
  elPresenceState.textContent = STATE_LABELS[snap.state] ?? snap.state
  elPresenceState.className = `presence-state ${snap.state}`
  elPresenceActivity.textContent = snap.activity || ''
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
  } catch (err) {
    console.error('initial load failed:', err)
    elConnection.hidden = false
  }
}

let evtSource = null

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
    } catch {}
  })
  evtSource.onopen = () => {
    elConnection.hidden = true
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
