// build-decisions.js — Yu-decision queue surface.
//
// Shows pending decisions Love has flagged. One-click responses
// (approve / deny / with-changes) plus optional reply text. Updates
// live via the SSE refresh path (covered by build-sse.js polling
// backstop) and on demand.

import { $, fetchJson, state } from './build-core.js'

const elBanner = $('decisions-banner')
const elList = $('decisions-list')
const elCount = $('decisions-count')

let lastSeenIds = new Set()

export async function fetchDecisions() {
  const projectId = state?.selectedProjectId
  if (!projectId || !elBanner) return
  try {
    const all = await fetchJson(`/api/decisions?project=${encodeURIComponent(projectId)}&status=open`)
    render(all)
  } catch (err) {
    // Silent fail — the banner just stays hidden / shows last data
  }
}

function render(decisions) {
  if (!elList || !elBanner || !elCount) return

  if (!decisions || decisions.length === 0) {
    elBanner.hidden = true
    elList.innerHTML = ''
    elCount.textContent = ''
    return
  }

  elBanner.hidden = false
  elCount.textContent = decisions.length === 1 ? '1' : `${decisions.length}`

  // If any new ones appeared since last render, briefly pulse the banner
  const newIds = decisions.filter(d => !lastSeenIds.has(d.id)).map(d => d.id)
  if (newIds.length > 0 && lastSeenIds.size > 0) {
    elBanner.classList.add('decisions-pulse')
    setTimeout(() => elBanner.classList.remove('decisions-pulse'), 1500)
  }
  lastSeenIds = new Set(decisions.map(d => d.id))

  elList.innerHTML = ''
  for (const d of decisions) {
    elList.appendChild(renderDecisionRow(d))
  }
}

function renderDecisionRow(d) {
  const li = document.createElement('li')
  li.className = `decision-item kind-${d.kind || 'review'}`

  const head = document.createElement('div')
  head.className = 'decision-head'

  const kindBadge = document.createElement('span')
  kindBadge.className = 'decision-kind'
  kindBadge.textContent = d.kind || 'review'
  head.appendChild(kindBadge)

  if (d.missionId) {
    const link = document.createElement('a')
    link.className = 'decision-mission-link mono'
    link.href = '#'
    link.textContent = d.missionId
    link.title = 'open mission detail'
    link.addEventListener('click', (e) => {
      e.preventDefault()
      state.selectedMissionId = d.missionId
      // Trigger render via build-data
      import('./build-data.js').then(m => m.loadProjectData())
    })
    head.appendChild(link)
  }

  const ago = formatAgo(d.createdAt)
  if (ago) {
    const ts = document.createElement('span')
    ts.className = 'decision-ts mono'
    ts.textContent = ago
    head.appendChild(ts)
  }

  li.appendChild(head)

  const ask = document.createElement('div')
  ask.className = 'decision-ask'
  ask.textContent = d.ask
  li.appendChild(ask)

  if (d.context) {
    const ctx = document.createElement('details')
    const sum = document.createElement('summary')
    sum.textContent = 'context'
    sum.className = 'decision-context-toggle'
    ctx.appendChild(sum)
    const pre = document.createElement('pre')
    pre.className = 'decision-context'
    pre.textContent = d.context
    ctx.appendChild(pre)
    li.appendChild(ctx)
  }

  const actions = document.createElement('div')
  actions.className = 'decision-actions'

  const options = (d.options && d.options.length)
    ? d.options
    : ['approved', 'denied', 'with-changes']

  for (const opt of options) {
    const btn = document.createElement('button')
    btn.className = `decision-btn decision-${opt}`
    btn.textContent = opt
    btn.addEventListener('click', () => respond(d.id, opt))
    actions.appendChild(btn)
  }

  const replyBtn = document.createElement('button')
  replyBtn.className = 'decision-btn decision-reply'
  replyBtn.textContent = '✎ reply with note'
  replyBtn.addEventListener('click', () => replyWithNote(d.id, options))
  actions.appendChild(replyBtn)

  li.appendChild(actions)
  return li
}

async function respond(decisionId, decision, note) {
  const projectId = state?.selectedProjectId
  if (!projectId) return
  const body = { decision }
  if (note) body.note = note
  try {
    await fetchJson(`/api/decisions/${encodeURIComponent(decisionId)}/respond?project=${encodeURIComponent(projectId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    fetchDecisions()
  } catch (err) {
    alert(`response failed: ${err.message}`)
  }
}

function replyWithNote(decisionId, options) {
  const decision = prompt(`decision (${options.join(' / ')}):`)
  if (!decision) return
  const note = prompt('note (optional):')
  respond(decisionId, decision, note || undefined)
}

function formatAgo(isoStr) {
  if (!isoStr) return ''
  const ms = Date.now() - new Date(isoStr).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 86400_000) return `${Math.round(ms / 3600_000)}h ago`
  return `${Math.round(ms / 86400_000)}d ago`
}

export function initDecisions() {
  // Initial fetch + 30s polling backstop (SSE will also trigger via build-sse)
  fetchDecisions()
  setInterval(fetchDecisions, 30_000)
}
