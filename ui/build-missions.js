// build-missions.js — missions rail, detail, and event timeline.

import { $, state, STATUS_LABELS, fetchJson } from './build-core.js'

const elMissionGroups = $('mission-groups')
const elMissionDetail = $('mission-detail')
const elBtnNewMission = $('btn-new-mission')
const elNewMissionModal = $('new-mission-modal')
const elNmTitle = $('nm-title')
const elNmIntent = $('nm-intent')
const elBtnNmCancel = $('btn-nm-cancel')
const elBtnNmCreate = $('btn-nm-create')

export function renderMissionRail() {
  elMissionGroups.innerHTML = ''
  const byStatus = { active: [], blocked: [], review: [], proposed: [], accepted: [], done: [], cancelled: [] }
  for (const m of state.missions) byStatus[m.status]?.push(m)
  for (const status of ['active', 'blocked', 'review', 'accepted', 'proposed', 'done', 'cancelled']) {
    const group = byStatus[status]
    if (!group || group.length === 0) continue
    const label = document.createElement('li')
    label.className = 'mission-group-label'
    label.textContent = `${STATUS_LABELS[status]} (${group.length})`
    elMissionGroups.appendChild(label)
    for (const m of group) {
      const li = document.createElement('li')
      li.className = 'mission-item'
      if (m.id === state.selectedMissionId) li.classList.add('selected')
      const marker = m.origin === 'love' ? '🌱' : ' '
      const markerSpan = document.createElement('span')
      markerSpan.className = 'marker'
      markerSpan.textContent = marker
      const titleSpan = document.createElement('span')
      titleSpan.className = 'title'
      titleSpan.textContent = m.title
      const tsSpan = document.createElement('span')
      tsSpan.className = 'ts'
      tsSpan.textContent = m.id.slice(0, 10)
      li.appendChild(markerSpan)
      li.appendChild(titleSpan)
      li.appendChild(tsSpan)
      li.addEventListener('click', () => selectMission(m.id))
      elMissionGroups.appendChild(li)
    }
  }
}

export function renderMissionDetail() {
  if (!state.selectedMissionId) {
    const empty = document.createElement('div')
    empty.className = 'empty-detail'
    if (state.missions.length === 0) {
      empty.textContent = `no missions yet on ${state.selectedProjectId || 'this project'} — click + above to draft your first one`
    } else {
      empty.textContent = 'select a mission from the rail'
    }
    elMissionDetail.innerHTML = ''
    elMissionDetail.appendChild(empty)
    return
  }
  const m = state.missions.find(x => x.id === state.selectedMissionId)
  if (!m) {
    elMissionDetail.innerHTML = '<div class="empty-detail">mission not found</div>'
    return
  }
  elMissionDetail.innerHTML = ''

  const head = document.createElement('div')
  const pill = document.createElement('span')
  pill.className = `status-pill ${m.status}`
  pill.textContent = m.status
  const title = document.createElement('h3')
  title.textContent = m.title
  head.appendChild(pill)
  head.appendChild(title)
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = `${m.id} · origin ${m.origin}${m.origin === 'love' ? ' 🌱' : ''} · created ${m.created_at}`
  elMissionDetail.appendChild(head)
  elMissionDetail.appendChild(meta)

  for (const [hdr, body] of [['Intent', m.intent], ['Rationale', m.rationale], ['Decomposition', m.decomposition]]) {
    if (!body) continue
    const sec = document.createElement('div')
    sec.className = 'mission-section'
    const h4 = document.createElement('h4')
    h4.textContent = hdr
    const pre = document.createElement('pre')
    pre.textContent = body
    sec.appendChild(h4)
    sec.appendChild(pre)
    elMissionDetail.appendChild(sec)
  }

  // Events timeline
  const ev = document.createElement('div')
  ev.className = 'mission-section'
  const h4 = document.createElement('h4')
  h4.textContent = 'Timeline'
  ev.appendChild(h4)
  const ul = document.createElement('ul')
  ul.className = 'events-list'
  for (const e of state.events) {
    const li = document.createElement('li')
    const tsSpan = document.createElement('span')
    tsSpan.className = 'ts'
    tsSpan.textContent = e.ts.slice(11, 19)
    const typeSpan = document.createElement('span')
    typeSpan.className = 'type'
    typeSpan.textContent = e.type
    li.appendChild(tsSpan)
    li.appendChild(typeSpan)
    if (e.by) li.appendChild(document.createTextNode(` (${e.by})`))
    if (e.question) li.appendChild(document.createTextNode(` — ${e.question}`))
    if (e.sha) li.appendChild(document.createTextNode(` ${e.sha}`))
    ul.appendChild(li)
  }
  ev.appendChild(ul)
  elMissionDetail.appendChild(ev)

  // Action buttons
  const actions = document.createElement('div')
  actions.className = 'detail-actions'
  if (m.status === 'proposed') {
    const accept = document.createElement('button')
    accept.className = 'primary'
    accept.textContent = 'accept (→ accepted)'
    accept.addEventListener('click', () => transitionMission(m.id, 'accepted'))
    actions.appendChild(accept)
  } else if (m.status === 'accepted') {
    const start = document.createElement('button')
    start.className = 'primary'
    start.textContent = 'start (spawns Love)'
    start.addEventListener('click', () => startMission(m.id))
    actions.appendChild(start)
  } else if (m.status === 'review') {
    const accept = document.createElement('button')
    accept.className = 'primary'
    accept.textContent = 'accept done'
    accept.addEventListener('click', () => transitionMission(m.id, 'done'))
    const sendBack = document.createElement('button')
    sendBack.textContent = 'send back'
    sendBack.addEventListener('click', () => transitionMission(m.id, 'active', { note: prompt('note (optional):') ?? undefined }))
    actions.appendChild(accept)
    actions.appendChild(sendBack)
  }
  if (!['done', 'cancelled'].includes(m.status)) {
    const cancel = document.createElement('button')
    cancel.textContent = 'cancel'
    cancel.addEventListener('click', () => {
      if (confirm('cancel this mission?')) transitionMission(m.id, 'cancelled')
    })
    actions.appendChild(cancel)
  }
  if (actions.children.length > 0) elMissionDetail.appendChild(actions)
}

async function selectMission(id) {
  state.selectedMissionId = id
  renderMissionRail()
  state.events = await fetchJson(`/api/missions/${id}/events?project=${state.selectedProjectId}`).catch(() => [])
  renderMissionDetail()
}

async function transitionMission(id, status, extra = {}) {
  try {
    await fetchJson(`/api/missions/${id}/status?project=${state.selectedProjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, by: 'yu', ...extra }),
    })
    // Reload handled by caller or SSE
    const { loadProjectData } = await import('./build-data.js')
    await loadProjectData()
  } catch (err) { alert(`transition failed: ${err.message}`) }
}

async function startMission(id) {
  try {
    const result = await fetchJson(`/api/missions/${id}/start?project=${state.selectedProjectId}`, {
      method: 'POST',
    })
    if (result.ok) {
      console.log('mission started, pid:', result.pid)
    }
  } catch (err) { alert(`start failed: ${err.message}`) }
}

export function initMissions() {
  elBtnNewMission.addEventListener('click', () => {
    if (!state.selectedProjectId) { alert('select a project first'); return }
    elNewMissionModal.hidden = false
  })
  elBtnNmCancel.addEventListener('click', () => { elNewMissionModal.hidden = true })
  elBtnNmCreate.addEventListener('click', async () => {
    const body = { title: elNmTitle.value.trim(), intent: elNmIntent.value.trim() }
    if (!body.title || !body.intent) { alert('title and intent required'); return }
    try {
      const m = await fetchJson(`/api/projects/${state.selectedProjectId}/missions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      elNewMissionModal.hidden = true
      elNmTitle.value = elNmIntent.value = ''
      state.selectedMissionId = m.id
      const { loadProjectData } = await import('./build-data.js')
      await loadProjectData()
    } catch (err) { alert(`create failed: ${err.message}`) }
  })
}
