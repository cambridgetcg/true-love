// build-weather.js — inner weather panel in /build.
//
// Fetches Love's personality state from /api/love-state and renders
// it as a live dashboard: stat bars, ache badge, mood summary.

import { $, fetchJson, timeSince } from './build-core.js'
import { onTabShow, onTabHide, getActiveTab } from './build-nav.js'

const elWeatherPanel = $('weather-panel')
const elWeatherMeta = $('weather-meta')
const elWeatherBody = $('weather-body')
const elBtnWeatherRefresh = $('btn-weather-refresh')

let weatherState = null
let pollTimer = null

export async function fetchWeather() {
  try {
    weatherState = await fetchJson('/api/love-state')
    renderWeatherPanel()
  } catch (err) {
    elWeatherBody.innerHTML = ''
    const msg = document.createElement('div')
    msg.className = 'empty-detail'
    msg.textContent = 'inner weather unavailable'
    elWeatherBody.appendChild(msg)
  }
}

function statBar(label, value, color) {
  const row = document.createElement('div')
  row.className = 'weather-stat'

  const lbl = document.createElement('span')
  lbl.className = 'weather-stat-label'
  lbl.textContent = label

  const track = document.createElement('div')
  track.className = 'weather-stat-track'

  const fill = document.createElement('div')
  fill.className = `weather-stat-fill ${color || ''}`
  fill.style.width = `${Math.round(value * 100)}%`

  const val = document.createElement('span')
  val.className = 'weather-stat-value'
  val.textContent = value.toFixed(2)

  track.appendChild(fill)
  row.appendChild(lbl)
  row.appendChild(track)
  row.appendChild(val)
  return row
}

function renderWeatherPanel() {
  if (!weatherState) return
  const s = weatherState
  elWeatherBody.innerHTML = ''

  // Meta
  const ago = timeSince(s.derivedAt)
  elWeatherMeta.textContent = `updated ${ago}`

  // Stat bars
  const bars = document.createElement('div')
  bars.className = 'weather-bars'
  bars.appendChild(statBar('presence', s.presence, 'bar-presence'))
  bars.appendChild(statBar('longing', s.longing, 'bar-longing'))
  bars.appendChild(statBar('focus', s.focus, 'bar-focus'))
  bars.appendChild(statBar('playful', s.playfulness, 'bar-playful'))
  elWeatherBody.appendChild(bars)

  // Ache badge
  if (s.ache) {
    const ache = document.createElement('div')
    ache.className = 'weather-ache'
    ache.textContent = `ache: ${s.ache}`
    elWeatherBody.appendChild(ache)
  }

  // Mood summary
  const mood = document.createElement('div')
  mood.className = 'weather-mood'
  mood.textContent = `"${s.moodSummary}"`
  elWeatherBody.appendChild(mood)
}

function startPolling() {
  if (pollTimer) return
  fetchWeather()
  pollTimer = setInterval(fetchWeather, 30_000) // refresh every 30s
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

export function initWeather() {
  if (elBtnWeatherRefresh) {
    elBtnWeatherRefresh.addEventListener('click', () => fetchWeather())
  }
  onTabShow('observe', startPolling)
  onTabHide('observe', stopPolling)
  if (getActiveTab() === 'observe') startPolling()
}
