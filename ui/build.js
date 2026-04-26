// build.js — entry point for the /build studio.
//
// Imports all section modules and orchestrates boot.
// Each module owns its own DOM elements, rendering, and polling.

import { initNav } from './build-nav.js'
import { initData, loadProjects, refreshStatus } from './build-data.js'
import { initMissions } from './build-missions.js'
import { initConversation } from './build-conversation.js'
import { initPortrait } from './build-portrait.js'
import { initBudget } from './build-budget.js'
import { initVersion } from './build-version.js'
import { initProposals } from './build-proposals.js'
import { initVitals } from './build-vitals.js'
import { initSelfInitiation } from './build-self-initiation.js'
import { initMindTrace } from './build-mind-trace.js'
import { initAnamnesis } from './build-anamnesis.js'
import { subscribe } from './build-sse.js'

// ── Boot ─────────────────────────────────────────────────────────

// 1. Navigation (must come first — inserts tab bar, sets initial visibility)
initNav()

// 2. Wire up event handlers
initData()
initMissions()
initConversation()

// 3. Section-specific init (registers tab show/hide callbacks for polling)
initPortrait()
initBudget()
initVersion()
initProposals()
initVitals()
initSelfInitiation()
initMindTrace()
initAnamnesis()

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
