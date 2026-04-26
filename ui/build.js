// build.js — vanilla browser logic for the /build studio.
//
// Subscribes to /api/build/stream for project/mission/thought events.
// Renders the missions rail, mission detail, thoughts tail, per-project
// conversation. Modals for new-mission and new-project.

const $ = (id) => document.getElementById(id)
const elProjSelect = $('proj-select')
const elBtnNewProject = $('btn-new-project')
const elPresenceInstance = $('presence-instance')
const elPresenceState = $('presence-state')
const elActivityBar = $('activity-bar')
const elBtnNewMission = $('btn-new-mission')
const elMissionGroups = $('mission-groups')
const elMissionDetail = $('mission-detail')
const elThoughtsList = $('thoughts-list')
const elConvList = $('conv-list')
const elConvProjName = $('conv-proj-name')
const elProjCompose = $('proj-compose')
const elProjComposeText = $('proj-compose-text')
const elBtnProjSend = $('btn-proj-send')
const elBtnProjWake = $('btn-proj-wake')
const elConnection = $('connection')

const elNewMissionModal = $('new-mission-modal')
const elNmTitle = $('nm-title')
const elNmIntent = $('nm-intent')
const elBtnNmCancel = $('btn-nm-cancel')
const elBtnNmCreate = $('btn-nm-create')

const elNewProjectModal = $('new-project-modal')
const elNpId = $('np-id')
const elNpName = $('np-name')
const elNpRoot = $('np-root')
const elNpInstance = $('np-instance')
const elNpCodeberg = $('np-codeberg')
const elBtnNpCancel = $('btn-np-cancel')
const elBtnNpCreate = $('btn-np-create')

const STATUS_LABELS = {
  proposed: 'proposed',
  accepted: 'accepted',
  active: 'active',
  blocked: 'blocked',
  review: 'review',
  done: 'done',
  cancelled: 'cancelled',
}

let state = {
  projects: [],
  selectedProjectId: null,
  missions: [],
  selectedMissionId: null,
  thoughts: [],
  conv: [],
  events: [],
}

// ── Fetchers ──────────────────────────────────────────────────────

async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

async function loadProjects() {
  state.projects = await fetchJson('/api/projects')
  renderProjectSwitcher()
  if (!state.selectedProjectId && state.projects.length > 0) {
    state.selectedProjectId = state.projects[0].id
    elProjSelect.value = state.selectedProjectId
    await loadProjectData()
  }
}

async function loadProjectData() {
  if (!state.selectedProjectId) return
  elConvProjName.textContent = state.selectedProjectId
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

async function loadMissionEvents(missionId) {
  state.events = await fetchJson(`/api/missions/${missionId}/events?project=${state.selectedProjectId}`).catch(() => [])
  renderMissionDetail()
}

// ── Renderers ─────────────────────────────────────────────────────

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
    opt.textContent = '(no projects — click + to register)'
    opt.disabled = true
    elProjSelect.appendChild(opt)
  }
  // Update presence-instance from project
  const cur = state.projects.find(p => p.id === state.selectedProjectId)
  elPresenceInstance.textContent = cur?.instance || '—'
}

function renderMissionRail() {
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

function renderMissionDetail() {
  if (!state.selectedMissionId) {
    elMissionDetail.innerHTML = '<div class="empty-detail">select a mission, or create one with +</div>'
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

function renderThoughts() {
  elThoughtsList.innerHTML = ''
  for (const t of state.thoughts) {
    const li = document.createElement('li')
    const tsSpan = document.createElement('span')
    tsSpan.className = 'ts'
    tsSpan.textContent = t.ts.slice(11, 19)
    const textSpan = document.createElement('span')
    textSpan.className = 'text'
    textSpan.textContent = t.text
    li.appendChild(tsSpan)
    li.appendChild(textSpan)
    elThoughtsList.appendChild(li)
  }
}

function renderConv() {
  elConvList.innerHTML = ''
  for (const m of state.conv) {
    const div = document.createElement('div')
    const isJournal = m.source === 'ai' && typeof m.tag === 'string' && m.tag.includes('heartbeat')
    div.className = `conv-msg from-${m.source}${isJournal ? ' is-journal' : ''}`
    const fromDiv = document.createElement('div')
    fromDiv.className = 'from'
    fromDiv.textContent = m.tag
    const bodyDiv = document.createElement('div')
    bodyDiv.className = 'body'
    bodyDiv.textContent = m.body
    div.appendChild(fromDiv)
    div.appendChild(bodyDiv)
    elConvList.appendChild(div)
  }
  elConvList.scrollTop = elConvList.scrollHeight
}

// ── Actions ───────────────────────────────────────────────────────

async function selectMission(id) {
  state.selectedMissionId = id
  renderMissionRail()
  await loadMissionEvents(id)
}

async function transitionMission(id, status, extra = {}) {
  try {
    await fetchJson(`/api/missions/${id}/status?project=${state.selectedProjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, by: 'yu', ...extra }),
    })
    await loadProjectData()
  } catch (err) { alert(`transition failed: ${err.message}`) }
}

async function startMission(id) {
  try {
    await fetchJson(`/api/missions/${id}/start?project=${state.selectedProjectId}&dry-run=1`, {
      method: 'POST',
    })
    alert('dry-run start succeeded — to actually spawn Love, run: bun run mission start --project=' + state.selectedProjectId + ' --mission=' + id)
  } catch (err) { alert(`start failed: ${err.message}`) }
}

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
    await fetchJson('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    elNewProjectModal.hidden = true
    elNpId.value = elNpName.value = elNpRoot.value = elNpCodeberg.value = ''
    state.selectedProjectId = body.id
    await loadProjects()
  } catch (err) { alert(`register failed: ${err.message}`) }
})

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
    await loadProjectData()
  } catch (err) { alert(`create failed: ${err.message}`) }
})

elProjCompose.addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = elProjComposeText.value.trim()
  if (!text || !state.selectedProjectId) return
  const wake = e.submitter?.value === 'wake'
  elBtnProjSend.disabled = true
  elBtnProjWake.disabled = true
  try {
    await fetchJson(`/api/projects/${state.selectedProjectId}/say`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, wake }),
    })
    elProjComposeText.value = ''
    await loadProjectData()
  } catch (err) { alert(`send failed: ${err.message}`) }
  finally { elBtnProjSend.disabled = false; elBtnProjWake.disabled = false; elProjComposeText.focus() }
})

// ── SSE ──────────────────────────────────────────────────────────

let evtSource = null

function subscribe() {
  if (evtSource) evtSource.close()
  evtSource = new EventSource('/api/build/stream')
  for (const eventName of ['project-changed', 'mission-changed', 'thought-appended']) {
    evtSource.addEventListener(eventName, async () => {
      // On any builder event, reload current project data. Cheap given the
      // single-user / single-tab assumption.
      await loadProjectData()
      if (state.selectedMissionId) await loadMissionEvents(state.selectedMissionId)
    })
  }
  evtSource.onopen = () => { elConnection.hidden = true }
  evtSource.onerror = () => { elConnection.hidden = false }
}

// ── Boot ─────────────────────────────────────────────────────────

loadProjects().then(subscribe).catch(err => {
  console.error('boot failed:', err)
  elConnection.hidden = false
})
