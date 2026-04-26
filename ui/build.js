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

const elPortraitPanel = $('portrait-panel')
const elPortraitMeta = $('portrait-meta')
const elPortraitBody = $('portrait-body')
const elBtnPortraitRefresh = $('btn-portrait-refresh')

const elProposalsPanel = $('proposals-panel')
const elProposalsMeta = $('proposals-meta')
const elProposalsBody = $('proposals-body')
const elBtnProposalsGenerate = $('btn-proposals-generate')
const elBtnProposalsRefresh = $('btn-proposals-refresh')

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
  if (elActivityBar) elActivityBar.textContent = ''  // clear empty-state hint
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
    opt.textContent = '(no projects yet)'
    opt.disabled = true
    elProjSelect.appendChild(opt)
    if (elActivityBar) elActivityBar.textContent = 'click the + button next to the project select to register your first project'
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

// ── Portrait ─────────────────────────────────────────────────────

let portraitState = null

async function fetchPortrait() {
  try {
    portraitState = await fetchJson('/api/introspect?days=7')
    renderPortraitPanel()
  } catch (err) {
    elPortraitBody.innerHTML = ''
    const msg = document.createElement('div')
    msg.className = 'empty-detail'
    msg.textContent = 'portrait unavailable'
    elPortraitBody.appendChild(msg)
  }
}

function renderPortraitPanel() {
  if (!portraitState) return
  const p = portraitState
  elPortraitBody.innerHTML = ''

  // Meta line
  const ago = timeSince(p.generatedAt)
  elPortraitMeta.textContent = `${p.daysAnalyzed}d · updated ${ago}`

  // ── Stats grid
  const grid = document.createElement('div')
  grid.className = 'portrait-grid'

  // Behavioral
  addStat(grid, 'ticks', p.behavioral.totalTicks)
  addStat(grid, 'sessions', p.behavioral.sessionCount)
  addStat(grid, 'hb-ok rate', pctStr(p.behavioral.heartbeatOkRate))
  addStat(grid, '1-tick yield', pctStr(p.behavioral.singleTickYieldRate))
  addStat(grid, 'avg tick/session', p.behavioral.avgTicksPerAwakened)
  addStat(grid, 'avg tick dur', p.behavioral.avgTickDurationSec + 's')
  if (p.behavioral.tickUtilization !== null) {
    addStat(grid, 'tick utilization', pctStr(p.behavioral.tickUtilization))
  }

  // Communication
  addStat(grid, 'msgs → yu', p.communication.messagesSentToYu)
  addStat(grid, 'msgs ← yu', p.communication.messagesFromYu)

  // Architecture
  addStat(grid, 'est. tokens', formatNum(p.architecture.estimatedTokensConsumed))
  if (p.architecture.authFailures > 0) {
    addStat(grid, 'auth fails', p.architecture.authFailures, 'warn')
  }
  if (p.architecture.quotaFailures > 0) {
    addStat(grid, 'quota fails', p.architecture.quotaFailures, 'warn')
  }

  elPortraitBody.appendChild(grid)

  // ── Tool usage (Phase 2)
  if (p.toolUsage && p.toolUsage.topTools.length > 0) {
    const sec = createSection('tool usage')
    const tools = document.createElement('div')
    tools.className = 'portrait-tools'
    for (const t of p.toolUsage.topTools.slice(0, 6)) {
      const item = document.createElement('span')
      item.className = 'tool-chip'
      item.textContent = `${t.tool} ${t.count}×`
      tools.appendChild(item)
    }
    sec.appendChild(tools)
    const meta = document.createElement('div')
    meta.className = 'portrait-small'
    meta.textContent = `avg ${p.toolUsage.avgToolsPerTick}/tick · ${p.toolUsage.zeroToolTicks} zero-tool ticks`
    sec.appendChild(meta)
    elPortraitBody.appendChild(sec)
  }

  // ── Velocity (Phase 2)
  if (p.velocity) {
    const sec = createSection('velocity')
    const vGrid = document.createElement('div')
    vGrid.className = 'portrait-grid compact'
    addStat(vGrid, 'chars/s', p.velocity.avgCharsPerSecond)
    addStat(vGrid, 'tokens/s', p.velocity.avgTokensPerSecond)
    addStat(vGrid, 'peak c/s', p.velocity.peakCharsPerSecond)
    addStat(vGrid, 'avg chars/tick', p.velocity.avgOutputCharsPerTick)
    sec.appendChild(vGrid)
    elPortraitBody.appendChild(sec)
  }

  // ── Yield patterns (Phase 2)
  if (p.yieldPatterns) {
    const sec = createSection('yield patterns')
    const sorted = Object.entries(p.yieldPatterns.distribution)
      .sort((a, b) => b[1] - a[1])
    if (sorted.length > 0) {
      const bar = document.createElement('div')
      bar.className = 'portrait-yield-bar'
      const total = sorted.reduce((s, [, c]) => s + c, 0)
      for (const [reason, count] of sorted) {
        const seg = document.createElement('div')
        seg.className = `yield-seg yield-${reason}`
        seg.style.flex = String(count)
        seg.title = `${reason}: ${count} (${Math.round(count / total * 100)}%)`
        bar.appendChild(seg)
      }
      sec.appendChild(bar)
      const legend = document.createElement('div')
      legend.className = 'portrait-small'
      legend.textContent = sorted.map(([r, c]) => `${r}: ${c}`).join(' · ')
      sec.appendChild(legend)
    }
    elPortraitBody.appendChild(sec)
  }

  // ── Loops
  if (p.loops && p.loops.length > 0) {
    const sec = createSection('detected loops')
    for (const loop of p.loops) {
      const item = document.createElement('div')
      item.className = 'portrait-loop'
      const name = document.createElement('span')
      name.className = 'loop-name'
      name.textContent = `${loop.name} (${loop.count}×)`
      const desc = document.createElement('span')
      desc.className = 'loop-desc'
      desc.textContent = loop.description
      item.appendChild(name)
      item.appendChild(desc)
      sec.appendChild(item)
    }
    elPortraitBody.appendChild(sec)
  }

  // ── Work hotfiles
  if (p.work && p.work.hotFiles && p.work.hotFiles.length > 0) {
    const sec = createSection('hot files')
    const list = document.createElement('div')
    list.className = 'portrait-hotfiles'
    for (const hf of p.work.hotFiles.slice(0, 5)) {
      const item = document.createElement('span')
      item.className = 'hotfile-chip'
      // Show just the filename, not the full path
      const short = hf.path.split('/').pop() || hf.path
      item.textContent = `${short} ${hf.count}×`
      item.title = hf.path
      list.appendChild(item)
    }
    sec.appendChild(list)
    elPortraitBody.appendChild(sec)
  }
}

// Portrait helpers

function addStat(parent, label, value, cls) {
  const el = document.createElement('div')
  el.className = 'portrait-stat' + (cls ? ` ${cls}` : '')
  const valEl = document.createElement('span')
  valEl.className = 'stat-val'
  valEl.textContent = String(value)
  const labEl = document.createElement('span')
  labEl.className = 'stat-label'
  labEl.textContent = label
  el.appendChild(valEl)
  el.appendChild(labEl)
  parent.appendChild(el)
}

function createSection(title) {
  const sec = document.createElement('div')
  sec.className = 'portrait-section'
  const h = document.createElement('div')
  h.className = 'portrait-section-title'
  h.textContent = title
  sec.appendChild(h)
  return sec
}

function pctStr(n) {
  return `${Math.round(n * 100)}%`
}

function formatNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function timeSince(isoStr) {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

if (elBtnPortraitRefresh) {
  elBtnPortraitRefresh.addEventListener('click', () => fetchPortrait())
}

// ── Proposals ────────────────────────────────────────────────────

let proposalsState = []

async function fetchProposals() {
  try {
    proposalsState = await fetchJson('/api/proposals')
    renderProposalsPanel()
  } catch (err) {
    if (elProposalsBody) {
      elProposalsBody.innerHTML = ''
      const msg = document.createElement('div')
      msg.className = 'empty-detail'
      msg.textContent = 'proposals unavailable'
      elProposalsBody.appendChild(msg)
    }
  }
}

async function generateNewProposals() {
  if (elBtnProposalsGenerate) elBtnProposalsGenerate.disabled = true
  try {
    const result = await fetchJson('/api/proposals/generate', { method: 'POST' })
    await fetchProposals()
    if (result.created && result.created.length > 0) {
      elProposalsMeta.textContent = `+${result.created.length} new`
    }
  } catch (err) {
    alert('generate failed: ' + err.message)
  } finally {
    if (elBtnProposalsGenerate) elBtnProposalsGenerate.disabled = false
  }
}

async function reviewProposalAction(id, decision, noteText) {
  try {
    const body = { decision }
    if (noteText) body.note = noteText
    await fetchJson(`/api/proposals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    await fetchProposals()
  } catch (err) {
    alert('review failed: ' + err.message)
  }
}

function renderProposalsPanel() {
  if (!elProposalsBody) return
  elProposalsBody.innerHTML = ''

  const proposed = proposalsState.filter(p => p.status === 'proposed')
  const reviewed = proposalsState.filter(p => p.status !== 'proposed')

  if (elProposalsMeta) {
    elProposalsMeta.textContent = proposed.length > 0
      ? `${proposed.length} pending`
      : `${proposalsState.length} total`
  }

  if (proposalsState.length === 0) {
    const msg = document.createElement('div')
    msg.className = 'empty-detail'
    msg.textContent = 'no proposals yet \u2014 click \u26a1 to generate'
    elProposalsBody.appendChild(msg)
    return
  }

  // Render proposed (pending) first
  if (proposed.length > 0) {
    const sec = createProposalSection('pending review')
    for (const p of proposed) {
      sec.appendChild(createProposalCard(p))
    }
    elProposalsBody.appendChild(sec)
  }

  // Then reviewed
  if (reviewed.length > 0) {
    const sec = createProposalSection('reviewed')
    for (const p of reviewed.slice(0, 5)) {
      sec.appendChild(createProposalCard(p))
    }
    elProposalsBody.appendChild(sec)
  }
}

function createProposalSection(title) {
  const sec = document.createElement('div')
  sec.className = 'proposal-section'
  const h = document.createElement('div')
  h.className = 'proposal-section-title'
  h.textContent = title
  sec.appendChild(h)
  return sec
}

function createProposalCard(p) {
  const card = document.createElement('div')
  card.className = `proposal-card severity-${p.severity} status-${p.status}`

  // Header row: severity icon + title + status badge
  const header = document.createElement('div')
  header.className = 'proposal-header'

  const icon = document.createElement('span')
  icon.className = 'proposal-severity'
  icon.textContent = { info: '\u2139\ufe0f', low: '\ud83d\udd35', medium: '\ud83d\udfe1', high: '\ud83d\udd34' }[p.severity] || '\u2753'
  header.appendChild(icon)

  const title = document.createElement('span')
  title.className = 'proposal-title'
  title.textContent = p.title
  header.appendChild(title)

  const badge = document.createElement('span')
  badge.className = `proposal-badge badge-${p.status}`
  badge.textContent = p.status
  header.appendChild(badge)

  card.appendChild(header)

  // Rationale (truncated)
  const rationale = document.createElement('div')
  rationale.className = 'proposal-rationale'
  rationale.textContent = p.rationale.length > 200
    ? p.rationale.slice(0, 200) + '\u2026'
    : p.rationale
  card.appendChild(rationale)

  // Action type chip
  const actionChip = document.createElement('span')
  actionChip.className = 'proposal-action-type'
  actionChip.textContent = p.action.type
  card.appendChild(actionChip)

  // Evidence chips
  if (p.evidence && p.evidence.length > 0) {
    const evRow = document.createElement('div')
    evRow.className = 'proposal-evidence'
    for (const e of p.evidence.slice(0, 3)) {
      const chip = document.createElement('span')
      chip.className = 'evidence-chip'
      chip.textContent = `${shortMetric(e.metric)}: ${formatEvValue(e.value)}`
      chip.title = e.threshold
      evRow.appendChild(chip)
    }
    card.appendChild(evRow)
  }

  // Action buttons (only for proposed)
  if (p.status === 'proposed') {
    const actions = document.createElement('div')
    actions.className = 'proposal-actions'

    const btnAccept = document.createElement('button')
    btnAccept.className = 'proposal-btn btn-accept'
    btnAccept.textContent = '\u2705 accept'
    btnAccept.addEventListener('click', () => reviewProposalAction(p.id, 'accepted'))
    actions.appendChild(btnAccept)

    const btnReject = document.createElement('button')
    btnReject.className = 'proposal-btn btn-reject'
    btnReject.textContent = '\u274c reject'
    btnReject.addEventListener('click', () => reviewProposalAction(p.id, 'rejected'))
    actions.appendChild(btnReject)

    card.appendChild(actions)
  }

  // Review info (for reviewed proposals)
  if (p.reviewedAt) {
    const review = document.createElement('div')
    review.className = 'proposal-review'
    review.textContent = `${p.status} ${timeSince(p.reviewedAt)}${p.reviewNote ? ' \u2014 ' + p.reviewNote : ''}`
    card.appendChild(review)
  }

  return card
}

function shortMetric(metric) {
  // "behavioral.heartbeatOkRate" -> "heartbeatOkRate"
  const parts = metric.split('.')
  return parts[parts.length - 1] || metric
}

function formatEvValue(val) {
  if (typeof val === 'number') {
    if (val < 1 && val > 0) return `${Math.round(val * 100)}%`
    if (val >= 1000) return formatNum(val)
    return String(Math.round(val * 100) / 100)
  }
  return String(val)
}

if (elBtnProposalsRefresh) {
  elBtnProposalsRefresh.addEventListener('click', () => fetchProposals())
}
if (elBtnProposalsGenerate) {
  elBtnProposalsGenerate.addEventListener('click', () => generateNewProposals())
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
    const result = await fetchJson(`/api/missions/${id}/start?project=${state.selectedProjectId}`, {
      method: 'POST',
    })
    if (result.ok) {
      // Mission is active. SSE will refresh the UI.
      console.log('mission started, pid:', result.pid)
    }
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
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 409) {
      // Already registered — switch to it instead of failing.
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

// Modals — Escape key dismisses any open modal; clicking the
// dark backdrop dismisses (clicking the inner .modal does not).
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    elNewMissionModal.hidden = true
    elNewProjectModal.hidden = true
  }
})
for (const overlay of [elNewMissionModal, elNewProjectModal]) {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.hidden = true
  })
}

async function refreshStatus() {
  try {
    const snap = await fetchJson('/api/status')
    if (snap.state) {
      elPresenceState.textContent = snap.state
      elPresenceState.className = `state ${snap.state}`
    }
    if (state.projects.length > 0 && elActivityBar) {
      // Activity from /api/status — only when we have projects (otherwise we
      // show the empty-state hint).
      elActivityBar.textContent = snap.activity || ''
    }
  } catch {}
}

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

loadProjects()
  .then(() => {
    refreshStatus()
    setInterval(refreshStatus, 10_000)  // poll status every 10s
    fetchPortrait()
    setInterval(fetchPortrait, 60_000)  // refresh portrait every 60s
    fetchProposals()
    setInterval(fetchProposals, 120_000)  // refresh proposals every 2m
    return subscribe()
  })
  .catch(err => {
    console.error('boot failed:', err)
    elConnection.hidden = false
  })
