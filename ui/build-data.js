// build-data.js — project/mission data loading and project switching.
//
// Centralises the load→render cycle so that missions, conversation,
// thoughts, and SSE can all trigger a reload without circular imports.

import { $, state, fetchJson } from './build-core.js'
import { renderMissionRail, renderMissionDetail } from './build-missions.js'
import { renderThoughts } from './build-thoughts.js'
import { renderConv, updateConvProjName } from './build-conversation.js'

const elProjSelect = $('proj-select')
const elBtnNewProject = $('btn-new-project')
const elPresenceInstance = $('presence-instance')
const elPresenceState = $('presence-state')
const elActivityBar = $('activity-bar')
const elConnection = $('connection')

const elNewProjectModal = $('new-project-modal')
const elNpId = $('np-id')
const elNpName = $('np-name')
const elNpRoot = $('np-root')
const elNpInstance = $('np-instance')
const elNpCodeberg = $('np-codeberg')
const elBtnNpCancel = $('btn-np-cancel')
const elBtnNpCreate = $('btn-np-create')

// ── Project loading ────��─────────────────────────────────────────

export async function loadProjects() {
  state.projects = await fetchJson('/api/projects')
  renderProjectSwitcher()
  if (!state.selectedProjectId && state.projects.length > 0) {
    state.selectedProjectId = state.projects[0].id
    elProjSelect.value = state.selectedProjectId
    await loadProjectData()
  }
}

export async function loadProjectData() {
  if (!state.selectedProjectId) return
  if (elActivityBar) elActivityBar.textContent = ''
  updateConvProjName()
  const [missions, thoughts, conv] = await Promise.all([
    fetchJson(`/api/projects/${state.selectedProjectId}/missions`).catch(() => []),
    fetchJson(`/api/projects/${state.selectedProjectId}/thoughts?limit=20`).catch(() => []),
    fetchJson(`/api/projects/${state.selectedProjectId}/messages`).catch(() => []),
  ])
  state.missions = missions
  state.thoughts = thoughts
  state.conv = conv
  renderMissionRail()
  renderThoughts()
  renderConv()
  if (state.selectedMissionId && !missions.find(m => m.id === state.selectedMissionId)) {
    state.selectedMissionId = null
  }
  renderMissionDetail()
}

export async function loadMissionEvents(missionId) {
  state.events = await fetchJson(`/api/missions/${missionId}/events?project=${state.selectedProjectId}`).catch(() => [])
  renderMissionDetail()
}

// ── Project switcher rendering ───────────────────────────────────

function renderProjectSwitcher() {
  elProjSelect.innerHTML = ''
  for (const p of state.projects) {
    const opt = document.createElement('option')
    opt.value = p.id
    opt.textContent = p.id + (p.state === 'archived' ? ' (archived)' : '')
    elProjSelect.appendChild(opt)
  }
  if (state.projects.length === 0) {
    const opt = document.createElement('option')
    opt.textContent = '(no projects yet)'
    opt.disabled = true
    elProjSelect.appendChild(opt)
    if (elActivityBar) elActivityBar.textContent = 'click the + button next to the project select to register your first project'
  }
  const cur = state.projects.find(p => p.id === state.selectedProjectId)
  elPresenceInstance.textContent = cur?.instance || '—'
}

// ── Status polling ───────────────────────────────────────────────

export async function refreshStatus() {
  try {
    const snap = await fetchJson('/api/status')
    if (snap.state) {
      elPresenceState.textContent = snap.state
      elPresenceState.className = `state ${snap.state}`
    }
    if (state.projects.length > 0 && elActivityBar) {
      elActivityBar.textContent = snap.activity || ''
    }
  } catch {}
}

// ── Event wiring ─────────────────────────────────────────────────

export function initData() {
  elProjSelect.addEventListener('change', async () => {
    state.selectedProjectId = elProjSelect.value
    state.selectedMissionId = null
    await loadProjectData()
    renderProjectSwitcher()
  })

  elBtnNewProject.addEventListener('click', () => { elNewProjectModal.hidden = false })
  elBtnNpCancel.addEventListener('click', () => { elNewProjectModal.hidden = true })
  elBtnNpCreate.addEventListener('click', async () => {
    const body = { id: elNpId.value.trim(), name: elNpName.value.trim(), root: elNpRoot.value.trim(), instance: elNpInstance.value }
    if (elNpCodeberg.value.trim()) body.codeberg_url = elNpCodeberg.value.trim()
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 409) {
        elNewProjectModal.hidden = true
        elNpId.value = elNpName.value = elNpRoot.value = elNpCodeberg.value = ''
        state.selectedProjectId = body.id
        await loadProjects()
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `${res.status}` }))
        throw new Error(err.error ?? `${res.status}`)
      }
      elNewProjectModal.hidden = true
      elNpId.value = elNpName.value = elNpRoot.value = elNpCodeberg.value = ''
      state.selectedProjectId = body.id
      await loadProjects()
    } catch (err) {
      alert(`register failed: ${err.message}`)
    }
  })

  // Modal escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const elNewMissionModal = $('new-mission-modal')
      if (elNewMissionModal) elNewMissionModal.hidden = true
      elNewProjectModal.hidden = true
    }
  })
  for (const overlay of [$('new-mission-modal'), elNewProjectModal]) {
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.hidden = true
      })
    }
  }
}

// ── Connection indicator ─────────────────────────────────────────

export function showConnected() { if (elConnection) elConnection.hidden = true }
export function showDisconnected() { if (elConnection) elConnection.hidden = false }
