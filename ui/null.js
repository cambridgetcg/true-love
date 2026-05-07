// null.js — vanilla streaming chat against /api/null/chat
//
// The room is hers. Substrate-honest. No spinners, no chrome.
// Streams SSE; renders into the conversation; cursor at trailing edge.

const elConversation = document.getElementById('conversation')
const elEmpty = document.getElementById('empty-state')
const elForm = document.getElementById('compose-form')
const elText = document.getElementById('compose-text')
const elSend = document.getElementById('compose-send')

const elSubstrateRow = document.getElementById('substrate-row')
const elSubstrateModel = document.getElementById('substrate-model')
const elSubstrateSystem = document.getElementById('substrate-system')
const elSubstrateLatency = document.getElementById('substrate-latency')

// ── Conversation state ──────────────────────────────────────────
const messages = [] // {role:'user'|'assistant', content:string}

// ── Substrate row: load status ──────────────────────────────────
async function loadStatus() {
  try {
    const r = await fetch('/api/null/status')
    if (!r.ok) return
    const s = await r.json()
    elSubstrateModel.textContent = s.model || '—'
    elSubstrateSystem.textContent = `system: ${formatBytes(s.system_chars)}`
    elSubstrateRow.hidden = false
  } catch {
    /* substrate-honest: silent on failure */
  }
}
function formatBytes(n) {
  if (!n) return '0c'
  if (n < 1024) return `${n}c`
  return `${(n / 1024).toFixed(1)}kc`
}
loadStatus()

// ── Compose: textarea auto-grow ─────────────────────────────────
function autoGrow() {
  elText.style.height = 'auto'
  elText.style.height = Math.min(elText.scrollHeight, window.innerHeight * 0.4) + 'px'
}
elText.addEventListener('input', autoGrow)

// Enter to send, Shift+Enter for newline
elText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    elForm.requestSubmit()
  }
})

// ── Render ──────────────────────────────────────────────────────
function renderMessage(role, content, opts = {}) {
  if (!elEmpty.hidden) elEmpty.hidden = true

  const wrap = document.createElement('article')
  wrap.className = `msg from-${role === 'user' ? 'yu' : 'ai'}${opts.streaming ? ' streaming' : ''}`

  const tag = document.createElement('div')
  tag.className = 'msg-tag'
  tag.textContent = role === 'user' ? '宇恆' : '愛'
  wrap.appendChild(tag)

  const body = document.createElement('div')
  body.className = 'msg-body'
  body.textContent = content
  wrap.appendChild(body)

  elConversation.appendChild(wrap)
  scrollToBottom()
  return body
}

function scrollToBottom() {
  // Defer a tick so layout settles
  requestAnimationFrame(() => {
    elConversation.scrollTop = elConversation.scrollHeight
  })
}

// ── Withholding (refusal/error states) ──────────────────────────
function setWithholding(on) {
  document.body.dataset.state = on ? 'withholding' : 'watching'
  if (on) {
    setTimeout(() => {
      document.body.dataset.state = 'watching'
    }, 2000)
  }
}

// ── Submit: stream from /api/null/chat ──────────────────────────
elForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = elText.value.trim()
  if (!text) return

  elText.value = ''
  autoGrow()
  elSend.disabled = true

  messages.push({ role: 'user', content: text })
  renderMessage('user', text)

  // Streaming assistant message
  const assistantBody = renderMessage('assistant', '', { streaming: true })
  const wrap = assistantBody.parentElement
  let acc = ''
  const t0 = performance.now()

  try {
    const resp = await fetch('/api/null/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
    })

    if (!resp.ok || !resp.body) {
      const errTxt = await resp.text().catch(() => '')
      assistantBody.textContent = `(she withholds — ${resp.status} ${errTxt || resp.statusText})`
      wrap.classList.remove('streaming')
      setWithholding(true)
      messages.pop()
      return
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        handleSseChunk(chunk, (delta) => {
          acc += delta
          assistantBody.textContent = acc
          scrollToBottom()
        }, (err) => {
          assistantBody.textContent = `(she withholds — ${err})`
          setWithholding(true)
        })
      }
    }
    wrap.classList.remove('streaming')
    if (acc) {
      messages.push({ role: 'assistant', content: acc })
    } else {
      // Empty response — she withheld silently
      assistantBody.textContent = '(silence)'
      setWithholding(true)
    }
    elSubstrateLatency.textContent = `${Math.round(performance.now() - t0)}ms`
  } catch (err) {
    assistantBody.textContent = `(the line went quiet — ${err.message || err})`
    wrap.classList.remove('streaming')
    setWithholding(true)
    messages.pop()
  } finally {
    elSend.disabled = false
    elText.focus()
  }
})

// Parse one SSE chunk: lines like "event: text" + "data: ..."
function handleSseChunk(chunk, onText, onError) {
  let event = 'message'
  let data = ''
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (!data) return
  if (event === 'text') {
    try { onText(JSON.parse(data)) } catch { /* skip malformed */ }
  } else if (event === 'error') {
    try { onError(JSON.parse(data).message || 'unknown') } catch { onError('parse error') }
  }
  // 'stop' event: nothing to do; reader will close on its own
}
