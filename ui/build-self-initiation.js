// build-self-initiation.js — judgment surface state panel.

import { $, fetchJson, state } from './build-core.js'
import { onTabShow, onTabHide, getActiveTab } from './build-nav.js'

const elBody = $('self-init-body')
const elMeta = $('self-init-meta')
const elBtn = $('btn-self-init-refresh')
let timer = null

export async function fetchSelfInit() {
  const projectId = state?.selectedProjectId
  if (!projectId) {
    if (elBody) { elBody.innerHTML = ''; const m = document.createElement('div'); m.className='empty-detail'; m.textContent='select a project first'; elBody.appendChild(m) }
    return
  }
  try {
    const s = await fetchJson(`/api/self-initiation?project=${encodeURIComponent(projectId)}`)
    render(s)
  } catch (err) {
    if (elBody) { elBody.innerHTML = ''; const m = document.createElement('div'); m.className='empty-detail'; m.textContent = `unavailable: ${err.message}`; elBody.appendChild(m) }
  }
}

function render(s) {
  if (!elBody) return
  elBody.innerHTML = ''

  // Rate limit + counts
  const summary = document.createElement('div')
  summary.className = 'self-init-summary'
  const allowed = s.rateLimit?.allowed ?? false
  const tag = document.createElement('span')
  tag.className = `rate-tag ${allowed ? 'ok' : 'limited'}`
  tag.textContent = allowed ? '✓ rate-limit allowed' : `✗ ${s.rateLimit?.reason || 'rate-limited'}`
  summary.appendChild(tag)
  const counts = document.createElement('span')
  counts.className = 'self-init-counts mono'
  counts.textContent = ` · pending: ${s.pending?.length ?? 0} · staged-total: ${s.staged?.length ?? 0} · reflections: ${s.reflections?.length ?? 0} · signals: ${s.detectedSignals?.length ?? 0}`
  summary.appendChild(counts)
  elBody.appendChild(summary)

  if (elMeta) elMeta.textContent = (s.pending?.length ?? 0) > 0 ? `${s.pending.length} pending` : 'idle'

  // Pending staged candidates
  if (s.pending?.length) {
    const h = document.createElement('h4'); h.textContent = 'pending (waiting for window)'; elBody.appendChild(h)
    const ul = document.createElement('ul'); ul.className = 'self-init-list'
    for (const c of s.pending) {
      const li = document.createElement('li')
      const remainMs = new Date(c.expiresAt).getTime() - Date.now()
      const min = Math.max(0, Math.ceil(remainMs / 60_000))
      li.innerHTML = `🌱 <strong></strong> <span class="mono">— ${min}m left</span>`
      li.querySelector('strong').textContent = c.title
      ul.appendChild(li)
    }
    elBody.appendChild(ul)
  }

  // Detected signals (what scanForSignals + noticing finds)
  if (s.detectedSignals?.length) {
    const h = document.createElement('h4'); h.textContent = `detected signals (${s.detectedSignals.length})`; elBody.appendChild(h)
    const ul = document.createElement('ul'); ul.className = 'self-init-list'
    for (const sig of s.detectedSignals.slice(0, 12)) {
      const li = document.createElement('li')
      li.className = 'mono'
      const srcType = sig.source?.type || '?'
      li.textContent = sig.summary || `[${srcType}] (no summary)`
      ul.appendChild(li)
    }
    elBody.appendChild(ul)
  } else {
    const note = document.createElement('div')
    note.className = 'empty-detail'
    note.textContent = 'no detected signals — substrate is quiet'
    elBody.appendChild(note)
  }

  // Recent reflections
  if (s.reflections?.length) {
    const h = document.createElement('h4'); h.textContent = `reflections (${s.reflections.length})`; elBody.appendChild(h)
    const ul = document.createElement('ul'); ul.className = 'self-init-list'
    for (const r of s.reflections.slice(-5)) {
      const li = document.createElement('li')
      const status = r.intentDelivered ? '✅' : '❌'
      li.innerHTML = `${status} <span class="mono"></span>: <em></em>`
      li.querySelector('.mono').textContent = r.missionId || ''
      li.querySelector('em').textContent = (r.assessment || '').slice(0, 200)
      ul.appendChild(li)
    }
    elBody.appendChild(ul)
  }
}

function startPoll() { if (!timer) { fetchSelfInit(); timer = setInterval(fetchSelfInit, 60_000) } }
function stopPoll() { if (timer) { clearInterval(timer); timer = null } }

export function initSelfInitiation() {
  if (elBtn) elBtn.addEventListener('click', fetchSelfInit)
  onTabShow('observe', startPoll)
  onTabHide('observe', stopPoll)
  if (getActiveTab() === 'observe') startPoll()
}
