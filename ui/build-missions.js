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

// done + cancelled are collapsed by default — they accumulate fast and bury
// the active/proposed items that actually need attention. Stored on window
// so a render cycle doesn't lose the state, but not persisted across reloads
// (intentional — each session starts with a clean view of "what's open").
window.__buildCollapsedGroups ??= new Set(['done', 'cancelled'])
const collapsedGroups = window.__buildCollapsedGroups

export function renderMissionRail() {
  elMissionGroups.innerHTML = ''
  const byStatus = { active: [], blocked: [], review: [], proposed: [], accepted: [], done: [], cancelled: [] }
  for (const m of state.missions) byStatus[m.status]?.push(m)
  for (const status of ['active', 'blocked', 'review', 'accepted', 'proposed', 'done', 'cancelled']) {
    const group = byStatus[status]
    if (!group || group.length === 0) continue
    const isCollapsible = status === 'done' || status === 'cancelled'
    const isCollapsed = isCollapsible && collapsedGroups.has(status)

    const label = document.createElement('li')
    label.className = 'mission-group-label'
    if (isCollapsible) label.classList.add('collapsible')
    if (isCollapsed) label.classList.add('collapsed')
    label.textContent = (isCollapsible ? (isCollapsed ? '▸ ' : '▾ ') : '') + `${STATUS_LABELS[status]} (${group.length})`
    if (isCollapsible) {
      label.style.cursor = 'pointer'
      label.addEventListener('click', () => {
        if (collapsedGroups.has(status)) collapsedGroups.delete(status)
        else collapsedGroups.add(status)
        renderMissionRail()
      })
    }
    elMissionGroups.appendChild(label)

    if (isCollapsed) continue

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

  // Progress section — live progress tracking
  const progressSec = document.createElement('div')
  progressSec.className = 'mission-section'
  const progressHdr = document.createElement('h4')
  progressHdr.style.cursor = 'pointer'
  progressHdr.textContent = '▸ Progress'
  const progressBody = document.createElement('div')
  progressBody.hidden = true
  progressSec.appendChild(progressHdr)
  progressSec.appendChild(progressBody)
  let progressLoaded = false
  progressHdr.addEventListener('click', async () => {
    progressBody.hidden = !progressBody.hidden
    progressHdr.textContent = (progressBody.hidden ? '▸' : '▾') + ' Progress'
    if (!progressBody.hidden && !progressLoaded) {
      progressBody.innerHTML = '<div class="empty-detail">loading…</div>'
      try {
        const data = await fetchJson(`/api/missions/${m.id}/progress?project=${state.selectedProjectId}`)
        renderProgressBody(progressBody, data)
        progressLoaded = true
      } catch (err) {
        progressBody.innerHTML = `<div class="empty-detail">progress unavailable: ${err.message}</div>`
      }
    }
  })
  // Auto-expand for active missions (most useful when they're being worked on)
  if (m.status === 'active') {
    progressBody.hidden = false
    progressHdr.textContent = '▾ Progress'
    fetchJson(`/api/missions/${m.id}/progress?project=${state.selectedProjectId}`)
      .then(data => { renderProgressBody(progressBody, data); progressLoaded = true })
      .catch(() => { progressBody.innerHTML = '<div class="empty-detail">no progress yet</div>' })
  }
  elMissionDetail.appendChild(progressSec)

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
  } else if (m.status === 'active') {
    const wake = document.createElement('button')
    wake.textContent = 'force awaken'
    wake.title = 'spawn an awakened session focused on this mission'
    wake.addEventListener('click', () => forceAwaken(m.id))
    actions.appendChild(wake)
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

  // Mission log — collapsed by default, fetch on click.
  const logSec = document.createElement('div')
  logSec.className = 'mission-section'
  const logHdr = document.createElement('h4')
  logHdr.style.cursor = 'pointer'
  logHdr.textContent = '▸ Mission Log'
  const logBody = document.createElement('div')
  logBody.hidden = true
  logSec.appendChild(logHdr)
  logSec.appendChild(logBody)
  let logLoaded = false
  logHdr.addEventListener('click', async () => {
    logBody.hidden = !logBody.hidden
    logHdr.textContent = (logBody.hidden ? '▸' : '▾') + ' Mission Log'
    if (!logBody.hidden && !logLoaded) {
      logBody.innerHTML = '<div class="empty-detail">loading…</div>'
      try {
        const log = await fetchJson(`/api/missions/${m.id}/log?project=${state.selectedProjectId}`)
        renderLogBody(logBody, log)
        logLoaded = true
      } catch (err) {
        logBody.innerHTML = `<div class="empty-detail">log unavailable: ${err.message}</div>`
      }
    }
  })
  elMissionDetail.appendChild(logSec)
}

function renderLogBody(container, log) {
  container.innerHTML = ''
  const a = log.aggregates
  const win = log.window
  const durHrs = (win.durationMs / 3_600_000).toFixed(2)

  const summary = document.createElement('div')
  summary.className = 'mono'
  summary.style.fontSize = '12px'
  summary.style.opacity = '0.85'
  summary.style.marginBottom = '8px'
  summary.textContent =
    `window: ${win.start.slice(11,19)} → ${win.end.slice(11,19)}${win.isOpen ? ' (open)' : ''} · ${durHrs}h · ` +
    `cost $${a.totalCostUsd.toFixed(4)} · ` +
    `${a.totalInputTokens.toLocaleString()}in / ${a.totalOutputTokens.toLocaleString()}out · ` +
    `${a.awakenedTicks} awakened, ${a.heartbeatTicks} heartbeat · ` +
    `${a.toolCallTotal} tool calls · ` +
    `${a.commitCount} commits (+${a.insertions}/-${a.deletions})`
  container.appendChild(summary)

  if (a.toolCallTotal > 0) {
    const tb = document.createElement('div')
    tb.className = 'mono'
    tb.style.fontSize = '11px'
    tb.style.opacity = '0.7'
    tb.style.marginBottom = '8px'
    tb.textContent = 'tools: ' + Object.entries(a.toolBreakdown)
      .sort((x, y) => y[1] - x[1])
      .map(([k, v]) => `${k}:${v}`).join(' · ')
    container.appendChild(tb)
  }

  // Merge timeline rows
  const rows = []
  for (const e of log.events) rows.push({ ts: e.ts, kind: 'event', text: `**${e.type}** by ${e.by || '?'}${e.note ? ' — ' + e.note.slice(0, 120) : ''}` })
  for (const t of log.traces) rows.push({ ts: t.ts, kind: 'trace', text: `${t.mode} tick ${t.tick} — ${t.steps} steps, ${t.toolCount} tools${t.costUsd ? ' $' + t.costUsd.toFixed(4) : ''}` })
  for (const c of log.commits) rows.push({ ts: c.ts, kind: 'commit', text: `${c.sha.slice(0, 8)} ${c.subject.slice(0, 90)} (+${c.insertions}/-${c.deletions})` })
  for (const r of log.reflections) rows.push({ ts: r.ts, kind: 'reflect', text: r.excerpt.slice(0, 120) })
  rows.sort((x, y) => x.ts.localeCompare(y.ts))

  const ul = document.createElement('ul')
  ul.className = 'events-list'
  ul.style.maxHeight = '300px'
  ul.style.overflowY = 'auto'
  for (const r of rows) {
    const li = document.createElement('li')
    li.className = 'mono'
    li.style.fontSize = '11px'
    const ts = document.createElement('span')
    ts.className = 'ts'
    ts.textContent = (r.ts.length >= 19 ? r.ts.slice(11, 19) : r.ts) + ' '
    const kind = document.createElement('span')
    kind.className = 'type'
    kind.textContent = r.kind.padEnd(8) + ' '
    kind.style.opacity = '0.6'
    const text = document.createElement('span')
    text.textContent = r.text
    li.appendChild(ts)
    li.appendChild(kind)
    li.appendChild(text)
    ul.appendChild(li)
  }
  container.appendChild(ul)
}

function renderProgressBody(container, data) {
  container.innerHTML = ''
  const { entries, latest, stall } = data

  if (!latest) {
    container.innerHTML = '<div class="empty-detail" style="opacity:0.5">no progress reported yet</div>'
    return
  }

  // Latest progress summary
  const statusColors = { IN_PROGRESS: '#4a9eff', BLOCKED: '#f5a623', COMPLETE: '#4ade80', ERROR: '#ef4444' }
  const statusIcons = { IN_PROGRESS: '🔵', BLOCKED: '🟡', COMPLETE: '✅', ERROR: '🔴' }

  const latestDiv = document.createElement('div')
  latestDiv.style.cssText = 'margin-bottom:8px;padding:8px;border-radius:6px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08)'

  const statusLine = document.createElement('div')
  statusLine.style.cssText = 'font-size:13px;margin-bottom:4px'
  statusLine.innerHTML = `${statusIcons[latest.status] || '⚪'} <strong style="color:${statusColors[latest.status] || '#888'}">${latest.status}</strong> · turn ${latest.turn} · confidence ${Math.round(latest.confidence * 100)}%`
  latestDiv.appendChild(statusLine)

  if (latest.summary) {
    const sumLine = document.createElement('div')
    sumLine.style.cssText = 'font-size:12px;opacity:0.85;margin-bottom:2px'
    sumLine.textContent = latest.summary
    latestDiv.appendChild(sumLine)
  }

  if (latest.next_step) {
    const nextLine = document.createElement('div')
    nextLine.style.cssText = 'font-size:11px;opacity:0.65'
    nextLine.textContent = `→ next: ${latest.next_step}`
    latestDiv.appendChild(nextLine)
  }

  if (latest.remaining) {
    const remLine = document.createElement('div')
    remLine.style.cssText = 'font-size:11px;opacity:0.55;margin-top:2px'
    remLine.textContent = `remaining: ${latest.remaining}`
    latestDiv.appendChild(remLine)
  }

  container.appendChild(latestDiv)

  // Stall warning
  if (stall && stall.stalled) {
    const stallDiv = document.createElement('div')
    stallDiv.style.cssText = 'padding:6px 8px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:4px;font-size:11px;margin-bottom:8px'
    stallDiv.textContent = `⚠ STALLED — same progress for ${stall.durationHours}h (${stall.repeatCount} reports): "${stall.nextStep}"`
    container.appendChild(stallDiv)
  }

  // History (collapsible, most recent first)
  if (entries.length > 1) {
    const histLabel = document.createElement('div')
    histLabel.style.cssText = 'font-size:11px;opacity:0.5;cursor:pointer;margin-top:4px'
    histLabel.textContent = `▸ ${entries.length} total reports`
    const histList = document.createElement('ul')
    histList.className = 'events-list'
    histList.style.cssText = 'max-height:200px;overflow-y:auto'
    histList.hidden = true
    histLabel.addEventListener('click', () => {
      histList.hidden = !histList.hidden
      histLabel.textContent = (histList.hidden ? '▸' : '▾') + ` ${entries.length} total reports`
    })
    // Show in reverse order (newest first)
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      const li = document.createElement('li')
      li.className = 'mono'
      li.style.fontSize = '10px'
      li.textContent = `#${e.turn} ${e.reportedAt?.slice(11, 19) || '?'} ${statusIcons[e.status] || '?'} ${e.summary?.slice(0, 80) || '(no summary)'}`
      histList.appendChild(li)
    }
    container.appendChild(histLabel)
    container.appendChild(histList)
  }
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

async function forceAwaken(missionId) {
  try {
    const result = await fetchJson('/api/awaken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ missionId, projectId: state.selectedProjectId, reason: `force-awaken: ${missionId}` }),
    })
    if (result.ok) {
      alert(`awakened session spawned (pid ${result.pid})`)
    }
  } catch (err) {
    if (err.message.includes('already running')) {
      alert('an awakened session is already running')
    } else {
      alert(`force-awaken failed: ${err.message}`)
    }
  }
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
