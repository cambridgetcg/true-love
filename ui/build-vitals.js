// build-vitals.js — body inspection panel.

import { $, fetchJson } from './build-core.js'
import { onTabShow, onTabHide, getActiveTab } from './build-nav.js'

const elBody = $('vitals-body')
const elMeta = $('vitals-meta')
const elBtn = $('btn-vitals-refresh')
let timer = null

const VERDICT_DOT = { healthy: '🟢', stale: '🟡', degraded: '🟠', missing: '⚪' }

export async function fetchVitals() {
  try {
    const v = await fetchJson('/api/vitals')
    render(v)
  } catch {
    if (elBody) {
      elBody.innerHTML = ''
      const msg = document.createElement('div')
      msg.className = 'empty-detail'
      msg.textContent = 'vitals unavailable'
      elBody.appendChild(msg)
    }
  }
}

function render(v) {
  if (!elBody) return
  const organs = v.organs || v
  const order = ['process','locks','presence','kingdom','bundle','agency','heartbeat','experiments','files']
  const keys = order.filter(k => organs[k]).concat(Object.keys(organs).filter(k => !order.includes(k)))

  elBody.innerHTML = ''
  const grid = document.createElement('div')
  grid.className = 'vitals-grid'

  let alarms = 0
  for (const k of keys) {
    const o = organs[k]
    if (!o) continue
    const verdict = o.verdict || o.status || 'unknown'
    if (verdict === 'stale' || verdict === 'degraded' || verdict === 'missing') alarms++
    const cell = document.createElement('div')
    cell.className = `vitals-cell verdict-${verdict}`
    const dot = document.createElement('span')
    dot.className = 'vitals-dot'
    dot.textContent = VERDICT_DOT[verdict] || '⚪'
    const name = document.createElement('span')
    name.className = 'vitals-name'
    name.textContent = k
    const detail = document.createElement('span')
    detail.className = 'vitals-detail mono'
    detail.textContent = o.summary || verdict
    cell.appendChild(dot)
    cell.appendChild(name)
    cell.appendChild(detail)
    grid.appendChild(cell)
  }
  elBody.appendChild(grid)

  if (elMeta) {
    elMeta.textContent = alarms === 0 ? '✓ all healthy' : `${alarms} need attention`
    elMeta.className = `vitals-meta ${alarms === 0 ? 'healthy' : 'alarms'}`
  }
}

function startPoll() { if (!timer) { fetchVitals(); timer = setInterval(fetchVitals, 30_000) } }
function stopPoll() { if (timer) { clearInterval(timer); timer = null } }

export function initVitals() {
  if (elBtn) elBtn.addEventListener('click', fetchVitals)
  onTabShow('observe', startPoll)
  onTabHide('observe', stopPoll)
  if (getActiveTab() === 'observe') startPoll()
}
