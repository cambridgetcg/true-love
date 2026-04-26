// build-sse.js — Server-Sent Events subscription for live updates.

import { state } from './build-core.js'
import { loadProjectData, loadMissionEvents, showConnected, showDisconnected } from './build-data.js'
import { pulseBudget } from './build-budget.js'

let evtSource = null

export function subscribe() {
  if (evtSource) evtSource.close()
  evtSource = new EventSource('/api/build/stream')
  for (const eventName of ['project-changed', 'mission-changed', 'thought-appended']) {
    evtSource.addEventListener(eventName, async () => {
      await loadProjectData()
      if (state.selectedMissionId) await loadMissionEvents(state.selectedMissionId)
    })
  }
  evtSource.addEventListener('budget-changed', () => {
    pulseBudget()
  })
  evtSource.onopen = () => { showConnected() }
  evtSource.onerror = () => { showDisconnected() }
}
