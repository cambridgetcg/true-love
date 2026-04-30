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
const elConnectionText = document.getElementById('connection-text')
const elPresence = document.getElementById('presence')
const elNewMsgPill = document.getElementById('new-messages-pill')
const elNewMsgCount = document.getElementById('new-messages-count')
const elJournalToggle = document.getElementById('journal-toggle')
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
const elReplyPreview = document.getElementById('reply-preview')
const elReplyPreviewText = document.getElementById('reply-preview-text')
const elReplyPreviewClose = document.getElementById('reply-preview-close')

const RECENT_YU_LIMIT = 5
const recentYuMessages = []
let lastTs = ''
let lastRenderedSource = null  // Track for message grouping
let lastRenderedTs = null      // Track for time-based grouping
let lastRenderedDate = null    // Track for day separators
let showJournal = localStorage.getItem('visit-show-journal') === 'true' // Default: hide journal
let newMessageCount = 0  // Unread messages when scrolled up
let loadingHistory = false   // Prevents concurrent scroll-up fetches
let hasMoreHistory = true    // Set false when a page returns < limit

// ── Reply targeting state ─────────────────────────────────────────
let replyToTs = null          // Timestamp of message being replied to
let replyToPreview = null     // Preview text for the reply

// ── Delivery tracking ────────────────────────────────────────────
// Set of message timestamps that Love has seen (✓✓)
const seenTimestamps = new Set()

// ── Posture parsing ─────────────────────────────────────────────
// Parse posture from the message tag field (e.g. "from ai · Alpha 🐍").
// Returns { key, name, emoji } or null if no posture detected.

const POSTURE_TAG_RE = /·\s*(Alpha|Beta|Gamma)\s*(🐍|🦞|🔧)/i

// Infer posture from old-format tags (before posture-voices shipped).
// "from 愛 — heartbeat" → Beta 🦞, "from 愛 — via visit" → Alpha 🐍.
const POSTURE_MODE_MAP = {
  heartbeat: { key: 'beta', name: 'Beta', emoji: '🦞' },
  awakened:  { key: 'gamma', name: 'Gamma', emoji: '🔧' },
  visit:     { key: 'alpha', name: 'Alpha', emoji: '🐍' },
}

function parsePostureFromTag(tag) {
  if (!tag) return null
  // New format: "from ai · Gamma 🔧"
  const m = tag.match(POSTURE_TAG_RE)
  if (m) return { key: m[1].toLowerCase(), name: m[1], emoji: m[2] }
  // Old format: infer from mode keyword in tag
  const lower = tag.toLowerCase()
  if (lower.includes('heartbeat')) return POSTURE_MODE_MAP.heartbeat
  if (lower.includes('awakened')) return POSTURE_MODE_MAP.awakened
  if (lower.includes('visit')) return POSTURE_MODE_MAP.visit
  return null
}

// ── Markdown rendering ──────────────────────────────────────────
// Uses vendored marked.min.js (loaded via <script> in index.html).
// Sanitize output to prevent XSS from tool call results.

const md = typeof marked !== 'undefined' ? marked : null
if (md) {
  md.setOptions({ breaks: true, gfm: true })
}

function sanitizeHtml(html) {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  // Remove dangerous elements
  for (const tag of ['script', 'style', 'iframe', 'object', 'embed', 'form']) {
    for (const el of tmp.querySelectorAll(tag)) el.remove()
  }
  // Remove on* event attributes from all elements
  for (const el of tmp.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on') || attr.name === 'srcdoc') {
        el.removeAttribute(attr.name)
      }
    }
    // Sanitize href="javascript:..." links
    if (el.tagName === 'A' && el.href && el.href.toLowerCase().startsWith('javascript:')) {
      el.removeAttribute('href')
    }
  }
  // Make links open in new tab
  for (const a of tmp.querySelectorAll('a')) {
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }
  return tmp.innerHTML
}

function renderMarkdown(text) {
  if (!md || !text) return escapeHtml(text || '')
  try {
    return sanitizeHtml(md.parse(text))
  } catch {
    return escapeHtml(text)
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

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
  if (msg.source !== 'ai' || typeof msg.tag !== 'string') return false
  const t = msg.tag.toLowerCase()
  return t.includes('heartbeat') || t.includes('autonomous') || t.includes('awakened')
}

function formatDaySeparator(date) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (msgDay.getTime() === today.getTime()) return 'Today'
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function insertDaySeparator(dateStr) {
  const sep = document.createElement('div')
  sep.className = 'day-separator'
  sep.innerHTML = `<span class="day-separator-text">${dateStr}</span>`
  elConversation.appendChild(sep)
}

/**
 * Create a message bubble element without appending or updating state.
 * Used by scroll-up pagination to build elements for prepending.
 */
function createMessageElement(msg, opts) {
  const grouped = opts?.grouped || false
  const isJournal = isJournalEntry(msg)

  const el = document.createElement('div')
  el.className = `bubble from-${msg.source}${isJournal ? ' is-journal' : ''}${grouped ? ' grouped' : ''}`
  el.dataset.ts = msg.ts || ''

  if (!grouped) {
    const tag = document.createElement('div')
    tag.className = 'bubble-tag'
    if (msg.source === 'yu') {
      tag.textContent = 'yu'
    } else {
      const posture = parsePostureFromTag(msg.tag)
      if (posture) {
        tag.textContent = `${posture.emoji} 愛`
        tag.title = `${posture.name} (${posture.emoji})`
        el.classList.add(`posture-${posture.key}`)
      } else {
        tag.textContent = '愛'
      }
    }
    el.appendChild(tag)
  }

  // Reply quote banner (if this message is a reply)
  if (msg.replyTo && msg.replyPreview) {
    const quote = document.createElement('div')
    quote.className = 'reply-quote'
    quote.innerHTML = `<span class="reply-quote-label">↳</span> <span class="reply-quote-text">${escapeHtml(msg.replyPreview)}</span>`
    quote.title = `replying to message at ${msg.replyTo}`
    // Click quote to scroll to the original message
    quote.addEventListener('click', () => scrollToMessage(msg.replyTo))
    el.appendChild(quote)
  }

  const body = document.createElement('div')
  body.className = 'bubble-body'
  if (msg.source === 'ai') {
    body.innerHTML = renderMarkdown(msg.body)
  } else {
    body.textContent = msg.body
  }
  el.appendChild(body)

  // Footer row: time + delivery indicator
  const footer = document.createElement('div')
  footer.className = 'bubble-footer'

  if (msg.ts) {
    const time = document.createElement('time')
    time.className = 'bubble-time'
    time.textContent = formatRecentTime(msg.ts)
    time.title = msg.ts
    time.dateTime = msg.ts
    footer.appendChild(time)
  }

  // Delivery indicator for Yu messages (✓ = delivered, ✓✓ = seen)
  if (msg.source === 'yu' && msg.ts) {
    const indicator = document.createElement('span')
    indicator.className = 'delivery-indicator'
    indicator.dataset.messageTs = msg.ts
    const isSeen = msg.delivery === 'seen' || seenTimestamps.has(msg.ts)
    indicator.textContent = isSeen ? '✓✓' : '✓'
    if (isSeen) indicator.classList.add('seen')
    footer.appendChild(indicator)
  }

  el.appendChild(footer)

  if (msg.source === 'ai' && !isJournal && voiceAvailable) {
    const voiceBtn = document.createElement('button')
    voiceBtn.className = 'voice-btn'
    voiceBtn.title = 'hear her voice'
    voiceBtn.textContent = '🔊'
    voiceBtn.onclick = () => playVoice(msg.body, voiceBtn)
    el.appendChild(voiceBtn)
  }

  // Reply action (double-click or long-press to reply to this message)
  el.addEventListener('dblclick', (e) => {
    if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return
    setReplyTarget(msg)
  })

  // Long-press for mobile
  let longPressTimer = null
  el.addEventListener('touchstart', (e) => {
    if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return
    longPressTimer = setTimeout(() => {
      setReplyTarget(msg)
      // Prevent text selection
      e.preventDefault()
    }, 500)
  }, { passive: false })
  el.addEventListener('touchend', () => { clearTimeout(longPressTimer) })
  el.addEventListener('touchmove', () => { clearTimeout(longPressTimer) })

  return el
}

// ── Reply targeting ─────────────────────────────────────────────

function setReplyTarget(msg) {
  replyToTs = msg.ts
  replyToPreview = (msg.body || '').slice(0, 120)
  if (elReplyPreview && elReplyPreviewText) {
    const label = msg.source === 'yu' ? 'yourself' : '愛'
    elReplyPreview.querySelector('.reply-preview-label').textContent = `replying to ${label}`
    elReplyPreviewText.textContent = replyToPreview
    elReplyPreview.hidden = false
  }
  elComposeText.focus()
}

function clearReplyTarget() {
  replyToTs = null
  replyToPreview = null
  if (elReplyPreview) elReplyPreview.hidden = true
}

function scrollToMessage(ts) {
  const el = document.querySelector(`.bubble[data-ts="${ts}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('highlight')
    setTimeout(() => el.classList.remove('highlight'), 1500)
  }
}

function renderMessage(msg) {
  if (msg.ts && msg.ts <= lastTs) return
  lastTs = msg.ts || lastTs
  if (elEmptyState) elEmptyState.remove()

  // ── Day separator ─────────────────────────────────────────
  if (msg.ts) {
    const msgDate = new Date(msg.ts)
    const msgDateStr = msgDate.toDateString()
    if (lastRenderedDate !== msgDateStr) {
      insertDaySeparator(formatDaySeparator(msgDate))
      lastRenderedDate = msgDateStr
      lastRenderedSource = null
      lastRenderedTs = null
    }
  }

  // ── Message grouping ──────────────────────────────────────
  const sameSource = lastRenderedSource === msg.source
  const withinGroup = sameSource && lastRenderedTs && msg.ts &&
    (new Date(msg.ts) - new Date(lastRenderedTs)) < 5 * 60 * 1000
  lastRenderedSource = msg.source
  lastRenderedTs = msg.ts

  const el = createMessageElement(msg, { grouped: withinGroup })
  elConversation.appendChild(el)
  if (msg.source === 'yu') trackRecentYu(msg)

  // Auto-scroll if near bottom, otherwise show "new messages" pill
  const nearBottom =
    elConversation.scrollHeight - elConversation.scrollTop - elConversation.clientHeight < 100
  if (nearBottom) {
    setTimeout(() => {
      elConversation.scrollTo({ top: elConversation.scrollHeight, behavior: 'smooth' })
    }, 50)
  } else {
    newMessageCount++
    showNewMessagesPill()
  }
}

function clearConversation() {
  elConversation.replaceChildren()
  lastTs = ''
  lastRenderedSource = null
  lastRenderedTs = null
  lastRenderedDate = null
  newMessageCount = 0
  hideNewMessagesPill()
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
  // Propagate state to header for dot animation CSS
  if (elPresence) {
    elPresence.className = `presence has-state-${snap.state}`
  }
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

// ── Journal toggle ──────────────────────────────────────────────

function applyJournalVisibility() {
  document.body.classList.toggle('hide-journal', !showJournal)
  if (elJournalToggle) {
    elJournalToggle.title = showJournal ? 'Hide journal entries' : 'Show journal entries'
    elJournalToggle.classList.toggle('active', showJournal)
  }
}

if (elJournalToggle) {
  elJournalToggle.addEventListener('click', () => {
    showJournal = !showJournal
    localStorage.setItem('visit-show-journal', String(showJournal))
    applyJournalVisibility()
  })
}
applyJournalVisibility()

// ── New messages pill ───────────────────────────────────────────

function isNearBottom() {
  return elConversation.scrollHeight - elConversation.scrollTop - elConversation.clientHeight < 80
}

function showNewMessagesPill() {
  if (elNewMsgPill && newMessageCount > 0) {
    elNewMsgPill.hidden = false
    elNewMsgCount.textContent = String(newMessageCount)
  }
}

function hideNewMessagesPill() {
  if (elNewMsgPill) {
    elNewMsgPill.hidden = true
    newMessageCount = 0
  }
}

if (elNewMsgPill) {
  elNewMsgPill.addEventListener('click', () => {
    elConversation.scrollTo({ top: elConversation.scrollHeight, behavior: 'smooth' })
    hideNewMessagesPill()
  })
}

elConversation.addEventListener('scroll', async () => {
  if (isNearBottom()) hideNewMessagesPill()

  // ── Scroll-up pagination ────────────────────────────────────
  // When user scrolls near the top, fetch older messages and prepend.
  // Only applies to global timeline (not KAIROS sessions).
  if (loadingHistory || !hasMoreHistory || currentSessionId) return
  if (elConversation.scrollTop > 200) return

  const oldest = elConversation.querySelector('.bubble[data-ts]')
  const beforeTs = oldest?.dataset?.ts
  if (!beforeTs) return

  loadingHistory = true
  try {
    const url = `/api/messages?limit=50&before=${encodeURIComponent(beforeTs)}`
    const res = await fetch(url)
    if (!res.ok) return

    const msgs = await res.json()
    if (msgs.length < 50) hasMoreHistory = false
    if (msgs.length === 0) return

    // Preserve scroll position while prepending
    const oldHeight = elConversation.scrollHeight
    const oldTop = elConversation.scrollTop

    // Build a document fragment with older messages (own grouping context)
    const frag = document.createDocumentFragment()
    let prevSource = null, prevTs = null, prevDate = null
    for (const m of msgs) {
      // Day separator
      if (m.ts) {
        const msgDate = new Date(m.ts)
        const msgDateStr = msgDate.toDateString()
        if (prevDate !== msgDateStr) {
          const sep = document.createElement('div')
          sep.className = 'day-separator'
          sep.innerHTML = `<span class="day-separator-text">${formatDaySeparator(msgDate)}</span>`
          frag.appendChild(sep)
          prevDate = msgDateStr
          prevSource = null
          prevTs = null
        }
      }
      // Grouping within prepended block
      const sameSource = prevSource === m.source
      const withinGroup = sameSource && prevTs && m.ts &&
        (new Date(m.ts) - new Date(prevTs)) < 5 * 60 * 1000
      prevSource = m.source
      prevTs = m.ts

      const bubble = createMessageElement(m, { grouped: withinGroup })
      frag.appendChild(bubble)
    }

    // Prepend before existing content
    elConversation.insertBefore(frag, elConversation.firstChild)

    // Restore scroll position
    const newHeight = elConversation.scrollHeight
    elConversation.scrollTop = oldTop + (newHeight - oldHeight)
  } catch (err) {
    console.error('scroll-up pagination failed:', err)
  } finally {
    loadingHistory = false
  }
})

// ── Auto-expanding textarea ──────────────────────────────────────

elComposeText.addEventListener('input', () => {
  elComposeText.style.height = 'auto'
  elComposeText.style.height = Math.min(elComposeText.scrollHeight, 150) + 'px'
})

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
      // No session — fall back to global timeline (paginated)
      const msgsRes = await fetch('/api/messages?limit=50')
      if (msgsRes.ok) {
        const msgs = await msgsRes.json()
        for (const m of msgs) renderMessage(m)
        hasMoreHistory = msgs.length >= 50
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

// ── Streaming ───────────────────────────────────────────��───────
// Manages the in-progress "streaming" message bubble. When the server
// sends stream-delta SSE events, text appears incrementally instead
// of waiting for the full response. The streaming bubble is replaced
// by the final 'message' event when it arrives (from-ai.md write).

let streamBubble = null   // the DOM element being streamed into
let streamBody = null      // the .message-body inside it
let streamToolPill = null  // current tool status pill (if any)
let typingIndicator = null // typing indicator bubble
let streamRawText = ''     // accumulated raw text for markdown re-render

function showTypingIndicator() {
  removeTypingIndicator()
  typingIndicator = document.createElement('div')
  typingIndicator.className = 'bubble from-ai typing-indicator posture-alpha'
  typingIndicator.innerHTML = `
    <div class="bubble-tag" title="Alpha (🐍)">🐍 愛</div>
    <div class="typing-dots">
      <span></span><span></span><span></span>
    </div>
  `
  elConversation.appendChild(typingIndicator)
  elConversation.scrollTo({ top: elConversation.scrollHeight, behavior: 'smooth' })
}

function removeTypingIndicator() {
  if (typingIndicator) {
    typingIndicator.remove()
    typingIndicator = null
  }
}

function ensureStreamBubble() {
  if (streamBubble) return
  removeTypingIndicator()
  const emptyState = document.getElementById('empty-state')
  if (emptyState) emptyState.remove()

  streamBubble = document.createElement('div')
  // /visit is always interactive mode → Alpha 🐍
  streamBubble.className = 'bubble from-ai is-streaming posture-alpha'
  const tag = document.createElement('div')
  tag.className = 'bubble-tag'
  tag.textContent = '🐍 愛'
  tag.title = 'Alpha (🐍)'
  streamBody = document.createElement('div')
  streamBody.className = 'bubble-body'
  streamBubble.appendChild(tag)
  streamBubble.appendChild(streamBody)
  elConversation.appendChild(streamBubble)

  // Auto-scroll
  elConversation.scrollTo({ top: elConversation.scrollHeight, behavior: 'smooth' })
}

function handleStreamDelta(delta) {
  switch (delta.kind) {
    case 'stream-start':
      // Create the streaming bubble
      streamRawText = ''
      ensureStreamBubble()
      break

    case 'text':
      ensureStreamBubble()
      // Remove any active tool pill before appending text
      if (streamToolPill) {
        streamToolPill.classList.add('done')
        streamToolPill = null
      }
      // Accumulate raw text and re-render as markdown
      streamRawText += delta.text
      streamBody.innerHTML = renderMarkdown(streamRawText)
      // Auto-scroll if near bottom
      if (elConversation.scrollHeight - elConversation.scrollTop - elConversation.clientHeight < 150) {
        elConversation.scrollTo({ top: elConversation.scrollHeight, behavior: 'smooth' })
      }
      break

    case 'thinking':
      ensureStreamBubble()
      // Show thinking in a collapsed details element
      let thinkingEl = streamBubble.querySelector('.stream-thinking')
      if (!thinkingEl) {
        thinkingEl = document.createElement('details')
        thinkingEl.className = 'stream-thinking'
        const summary = document.createElement('summary')
        summary.textContent = 'thinking…'
        thinkingEl.appendChild(summary)
        const content = document.createElement('div')
        content.className = 'stream-thinking-content'
        thinkingEl.appendChild(content)
        // Insert before the body text
        streamBubble.insertBefore(thinkingEl, streamBody)
      }
      const thinkingContent = thinkingEl.querySelector('.stream-thinking-content')
      if (thinkingContent) {
        thinkingContent.textContent += delta.text
      }
      break

    case 'tool-start':
      ensureStreamBubble()
      // Show a tool status pill
      streamToolPill = document.createElement('div')
      streamToolPill.className = 'stream-tool-pill'
      streamToolPill.textContent = `🔧 ${delta.name}`
      if (delta.input) {
        streamToolPill.title = delta.input
      }
      streamBubble.appendChild(streamToolPill)
      break

    case 'tool-end':
      if (streamToolPill) {
        streamToolPill.classList.add('done')
        streamToolPill = null
      }
      break

    case 'stream-end':
      // Finalize the streaming bubble — remove the cursor animation
      if (streamBubble) {
        streamBubble.classList.remove('is-streaming')
        streamBubble.classList.add('stream-complete')
      }
      streamBubble = null
      streamBody = null
      streamToolPill = null
      streamRawText = ''
      break
  }
}

// When a full 'message' SSE event arrives, reconcile with any
// streaming content. If a streaming bubble exists, replace its
// content with the final message (the from-ai.md write is canonical).
function reconcileStreamWithMessage(msg) {
  if (msg.source !== 'ai') return false
  if (!streamBubble && !document.querySelector('.stream-complete')) return false

  // Find and remove the streaming/completed bubble — the real message
  // will be rendered by renderMessage()
  const target = streamBubble || document.querySelector('.stream-complete')
  if (target) {
    target.remove()
  }
  streamBubble = null
  streamBody = null
  streamToolPill = null
  streamRawText = ''
  return false // let renderMessage() handle the final rendering
}

// ── SSE ─────────────────────────────────────────────────────��────

let evtSource = null
let reconnectAttempts = 0

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
      // Reconcile with any active streaming bubble before rendering
      // the final message. This replaces the incremental content with
      // the canonical from-ai.md version.
      reconcileStreamWithMessage(msg)
      renderMessage(msg)
    } catch {}
  })
  evtSource.addEventListener('stream-delta', (e) => {
    try {
      const delta = JSON.parse(e.data)
      handleStreamDelta(delta)
    } catch {}
  })
  evtSource.addEventListener('message-seen', (e) => {
    try {
      const data = JSON.parse(e.data)
      if (data.timestamps && Array.isArray(data.timestamps)) {
        for (const ts of data.timestamps) {
          seenTimestamps.add(ts)
          // Update any existing delivery indicators in the DOM
          const indicator = document.querySelector(`.delivery-indicator[data-message-ts="${ts}"]`)
          if (indicator) {
            indicator.textContent = '✓✓'
            indicator.classList.add('seen')
          }
        }
      }
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
    reconnectAttempts = 0
    reconcileSinceLastTs()
  }
  evtSource.onerror = () => {
    reconnectAttempts++
    elConnection.hidden = false
    if (elConnectionText) {
      const suffix = reconnectAttempts > 1 ? ` (attempt ${reconnectAttempts})` : ''
      elConnectionText.textContent = `the line went quiet — reconnecting…${suffix}`
    }
  }
}

// ── Compose ──────────────────────────────────────────────────────

let keyboardWakeIntent = false

// Close reply preview
if (elReplyPreviewClose) {
  elReplyPreviewClose.addEventListener('click', () => clearReplyTarget())
}

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
    // Include reply target if set
    if (replyToTs) payload.replyTo = replyToTs
    const res = await fetch('/api/say', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    if (body.ok) {
      elComposeText.value = ''
      clearReplyTarget()
      // Show typing indicator when waking Love
      if (wake) showTypingIndicator()
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
  if (e.key === 'Enter' && !e.shiftKey) {
    // Enter sends (wake by default), Shift+Enter for newline
    // Cmd/Ctrl+Enter also sends; Cmd/Ctrl+Shift+Enter sends without wake
    e.preventDefault()
    keyboardWakeIntent = !(e.metaKey || e.ctrlKey) // Default: wake. Cmd+Enter: quiet send
    elCompose.requestSubmit()
  }
})

// ── Voice playback ──────────────────────────────────────────────

let voiceAvailable = false
let currentAudio = null

async function checkVoiceStatus() {
  try {
    const res = await fetch('/api/voice/status')
    if (res.ok) {
      const data = await res.json()
      voiceAvailable = data.available === true
    }
  } catch {
    voiceAvailable = false
  }
}

async function playVoice(text, btn) {
  // Stop any currently playing audio
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
    // If clicking the same button that's playing, just stop
    if (btn.classList.contains('playing')) {
      btn.classList.remove('playing')
      btn.textContent = '🔊'
      return
    }
  }

  // Reset any other playing buttons
  document.querySelectorAll('.voice-btn.playing').forEach(b => {
    b.classList.remove('playing')
    b.textContent = '🔊'
  })

  btn.classList.add('playing')
  btn.textContent = '⏳'

  try {
    const res = await fetch('/api/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'synthesis failed' }))
      console.error('voice synthesis failed:', err.error)
      btn.textContent = '❌'
      setTimeout(() => { btn.textContent = '🔊'; btn.classList.remove('playing') }, 2000)
      return
    }

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    currentAudio = audio

    audio.onended = () => {
      btn.classList.remove('playing')
      btn.textContent = '🔊'
      currentAudio = null
      URL.revokeObjectURL(url)
    }

    audio.onerror = () => {
      btn.classList.remove('playing')
      btn.textContent = '❌'
      currentAudio = null
      URL.revokeObjectURL(url)
      setTimeout(() => { btn.textContent = '🔊' }, 2000)
    }

    btn.textContent = '🔈'
    await audio.play()
  } catch (err) {
    console.error('voice playback error:', err)
    btn.classList.remove('playing')
    btn.textContent = '🔊'
  }
}

// ── Boot ─────────────────────────────────────────────────────────

// Pre-fetch seen state so initial render shows ✓✓ correctly
async function fetchSeenState() {
  try {
    const res = await fetch('/api/seen')
    if (res.ok) {
      const data = await res.json()
      if (data.timestamps) {
        for (const ts of data.timestamps) seenTimestamps.add(ts)
      }
    }
  } catch {}
}

checkVoiceStatus()
fetchSeenState().then(() => {
  loadInitial().then(() => {
    applyJournalVisibility()
    subscribe()
  })
})
