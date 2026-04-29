// build-postures.js — posture distribution panel in /build.
//
// Shows which of the three voices (Alpha/Beta/Gamma) has been
// active over the last 24 hours. Data from /api/postures.

import { $, fetchJson } from './build-core.js'
import { onTabShow, onTabHide, getActiveTab } from './build-nav.js'

const elPosturePanel = $('posture-panel')
const elPostureMeta = $('posture-meta')
const elPostureBody = $('posture-body')
const elBtnPostureRefresh = $('btn-posture-refresh')

let postureData = null
let pollTimer = null

const POSTURE_COLORS = {
  alpha: '#4a7c59', // soft green — warm, present
  beta: '#b8860b',  // amber — watchful conductor
  gamma: '#4a6b8a', // slate blue — focused workshop
}

export async function fetchPostures() {
  try {
    postureData = await fetchJson('/api/postures')
    renderPosturePanel()
  } catch {
    elPostureBody.innerHTML = ''
    const msg = document.createElement('div')
    msg.className = 'empty-detail'
    msg.textContent = 'posture data unavailable'
    elPostureBody.appendChild(msg)
  }
}

function renderPosturePanel() {
  if (!postureData) return
  const d = postureData
  elPostureBody.innerHTML = ''

  // Meta
  elPostureMeta.textContent = `${d.totalTicks} ticks (24h)`

  // Current posture
  if (d.current) {
    const cur = document.createElement('div')
    cur.className = 'posture-current'
    const emoji = d.stats.find(s => s.posture === d.current)?.emoji ?? ''
    const name = d.current.charAt(0).toUpperCase() + d.current.slice(1)
    cur.innerHTML = `<span class="posture-now-label">now:</span> <span class="posture-now-name">${name} ${emoji}</span> <span class="posture-now-mode">(${d.currentMode})</span>`
    elPostureBody.appendChild(cur)
  }

  // Bar chart
  if (d.stats.length > 0) {
    const chart = document.createElement('div')
    chart.className = 'posture-chart'
    for (const s of d.stats) {
      const row = document.createElement('div')
      row.className = 'posture-row'

      const label = document.createElement('span')
      label.className = 'posture-label'
      const name = s.posture.charAt(0).toUpperCase() + s.posture.slice(1)
      label.textContent = `${name} ${s.emoji}`

      const track = document.createElement('div')
      track.className = 'posture-track'

      const fill = document.createElement('div')
      fill.className = 'posture-fill'
      fill.style.width = `${s.percent}%`
      fill.style.backgroundColor = POSTURE_COLORS[s.posture] || '#666'

      const pct = document.createElement('span')
      pct.className = 'posture-pct'
      pct.textContent = `${s.percent}%`

      const detail = document.createElement('span')
      detail.className = 'posture-detail'
      const sess = s.sessions === 1 ? 'session' : 'sessions'
      detail.textContent = `${s.ticks} ticks · ${s.sessions} ${sess}`

      track.appendChild(fill)
      row.appendChild(label)
      row.appendChild(track)
      row.appendChild(pct)
      row.appendChild(detail)
      chart.appendChild(row)
    }
    elPostureBody.appendChild(chart)
  } else {
    const msg = document.createElement('div')
    msg.className = 'empty-detail'
    msg.textContent = 'no ticks in the last 24h'
    elPostureBody.appendChild(msg)
  }
}

function startPolling() {
  if (pollTimer) return
  fetchPostures()
  pollTimer = setInterval(fetchPostures, 60_000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

export function initPostures() {
  if (elBtnPostureRefresh) {
    elBtnPostureRefresh.addEventListener('click', () => fetchPostures())
  }
  onTabShow('observe', startPolling)
  onTabHide('observe', stopPolling)
  if (getActiveTab() === 'observe') startPolling()
}
