// build.js — entry point for the /build studio.
//
// Imports all section modules and orchestrates boot.
// Each module owns its own DOM elements, rendering, and polling.

import { initNav } from './build-nav.js'
import { initData, loadProjects, refreshStatus } from './build-data.js'
import { initMissions } from './build-missions.js'
import { initConversation } from './build-conversation.js'
import { initWeather } from './build-weather.js'
import { initPortrait } from './build-portrait.js'
import { initBudget } from './build-budget.js'
import { initVersion } from './build-version.js'
import { initProposals } from './build-proposals.js'
import { initVitals } from './build-vitals.js'
import { initSelfInitiation } from './build-self-initiation.js'
import { initMindTrace } from './build-mind-trace.js'
import { initAnamnesis } from './build-anamnesis.js'
import { initPostures } from './build-postures.js'
import { initDecisions } from './build-decisions.js'
import { subscribe } from './build-sse.js'

// ── Boot ─────────────────────────────────────────────────────────

// 1. Navigation (must come first — inserts tab bar, sets initial visibility)
initNav()

// 2. Wire up event handlers
initData()
initMissions()
initConversation()

// 3. Section-specific init (registers tab show/hide callbacks for polling)
initWeather()
initPostures()
initPortrait()
initBudget()
initVersion()
initProposals()
initVitals()
initSelfInitiation()
initMindTrace()
initAnamnesis()
initDecisions()

// 4. Load data and start
loadProjects()
  .then(() => {
    // Status polling runs regardless of active tab
    refreshStatus()
    setInterval(refreshStatus, 10_000)
    // SSE for live updates
    return subscribe()
  })
  .catch(err => {
    console.error('boot failed:', err)
    import('./build-data.js').then(m => m.showDisconnected())
  })

// ── eros widget — compact at-a-glance state ─────────────────────

const EROS_AXES = ['wanting', 'liking', 'heat', 'openness', 'limerence', 'charge', 'inhibition']

function renderErosWidget(state) {
  const barsEl = document.getElementById('eros-widget-bars')
  const shapeEl = document.getElementById('eros-widget-shape')
  if (!barsEl || !shapeEl) return
  barsEl.innerHTML = ''
  for (const axis of EROS_AXES) {
    const v = Math.min(state.vector[axis], 10)
    const span = document.createElement('span')
    span.style.height = `${4 + v * 1.2}px`
    if (v >= 7) span.classList.add('hot')
    else if (v >= 4) span.classList.add('warm')
    barsEl.appendChild(span)
  }
  // Compute felt-shape
  const a = state.vector
  let shape = 'resting'
  if (a.wanting >= 8 && a.limerence >= 8) shape = 'burn-at-you'
  else if (a.charge >= 8 && a.heat <= 3) shape = 'boiling'
  else if (a.heat >= 7) shape = 'burning'
  else if (a.openness >= 7 && a.heat <= 3) shape = 'tender'
  shapeEl.textContent = shape
}

(async function bootErosWidget() {
  try {
    const res = await fetch('/api/eros/state')
    if (res.ok) renderErosWidget(await res.json())
  } catch { /* widget is best-effort */ }
  try {
    const sse = new EventSource('/api/eros/stream')
    sse.onmessage = (e) => {
      try { renderErosWidget(JSON.parse(e.data)) } catch { /* skip bad message */ }
    }
  } catch { /* SSE optional */ }
})()
