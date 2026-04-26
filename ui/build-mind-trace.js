// build-mind-trace.js — recent decision traces panel.

import { $, fetchJson } from './build-core.js'
import { onTabShow, onTabHide, getActiveTab } from './build-nav.js'

const elBody = $('mind-trace-body')
const elMeta = $('mind-trace-meta')
const elBtn = $('btn-mind-trace-refresh')
let timer = null

export async function fetchMindTrace() {
  try {
    const traces = await fetchJson('/api/mind-trace?days=2&limit=10')
    render(traces)
  } catch (err) {
    if (elBody) { elBody.innerHTML = ''; const m = document.createElement('div'); m.className='empty-detail'; m.textContent='no traces yet — runner records traces during awakened/heartbeat ticks'; elBody.appendChild(m) }
  }
}

function render(traces) {
  if (!elBody) return
  elBody.innerHTML = ''

  if (!traces?.length) {
    const m = document.createElement('div'); m.className='empty-detail'
    m.textContent = 'no recent traces (last 2 days)'
    elBody.appendChild(m)
    if (elMeta) elMeta.textContent = ''
    return
  }

  if (elMeta) elMeta.textContent = `${traces.length} recent trace${traces.length === 1 ? '' : 's'}`

  const ul = document.createElement('ul')
  ul.className = 'mind-trace-list'
  for (const t of traces.slice(-10)) {
    const li = document.createElement('li')
    li.className = 'mind-trace-item'
    const head = document.createElement('div')
    head.className = 'trace-head mono'
    const ts = (t.startedAt || t.ts || '').slice(11, 19)
    const mode = t.mode || '?'
    const stepCount = t.steps?.length ?? 0
    head.textContent = `${ts} · ${mode} · ${stepCount} step${stepCount === 1 ? '' : 's'}`
    li.appendChild(head)
    if (t.summary) {
      const sum = document.createElement('div')
      sum.className = 'trace-summary'
      sum.textContent = typeof t.summary === 'string' ? t.summary.slice(0, 200) : JSON.stringify(t.summary).slice(0, 200)
      li.appendChild(sum)
    }
    if (t.steps?.length) {
      const tools = t.steps.map(s => s.tool || s.kind).filter(Boolean).slice(0, 8).join(' → ')
      if (tools) {
        const chain = document.createElement('div')
        chain.className = 'trace-chain mono'
        chain.textContent = tools
        li.appendChild(chain)
      }
    }
    ul.appendChild(li)
  }
  elBody.appendChild(ul)
}

function startPoll() { if (!timer) { fetchMindTrace(); timer = setInterval(fetchMindTrace, 90_000) } }
function stopPoll() { if (timer) { clearInterval(timer); timer = null } }

export function initMindTrace() {
  if (elBtn) elBtn.addEventListener('click', fetchMindTrace)
  onTabShow('observe', startPoll)
  onTabHide('observe', stopPoll)
  if (getActiveTab() === 'observe') startPoll()
}
