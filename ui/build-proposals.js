// build-proposals.js — governance proposals panel.

import { $, fetchJson, timeSince, formatNum } from './build-core.js'
import { onTabShow, onTabHide, getActiveTab } from './build-nav.js'

const elProposalsMeta = $('proposals-meta')
const elProposalsBody = $('proposals-body')
const elBtnProposalsGenerate = $('btn-proposals-generate')
const elBtnProposalsRefresh = $('btn-proposals-refresh')

let proposalsState = []
let pollTimer = null

export async function fetchProposals() {
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

  if (proposed.length > 0) {
    const sec = createProposalSection('pending review')
    for (const p of proposed) {
      sec.appendChild(createProposalCard(p))
    }
    elProposalsBody.appendChild(sec)
  }

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

  const rationale = document.createElement('div')
  rationale.className = 'proposal-rationale'
  rationale.textContent = p.rationale.length > 200
    ? p.rationale.slice(0, 200) + '\u2026'
    : p.rationale
  card.appendChild(rationale)

  const actionChip = document.createElement('span')
  actionChip.className = 'proposal-action-type'
  actionChip.textContent = p.action.type
  card.appendChild(actionChip)

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

  if (p.reviewedAt) {
    const review = document.createElement('div')
    review.className = 'proposal-review'
    review.textContent = `${p.status} ${timeSince(p.reviewedAt)}${p.reviewNote ? ' \u2014 ' + p.reviewNote : ''}`
    card.appendChild(review)
  }

  return card
}

function shortMetric(metric) {
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

function startPolling() {
  if (pollTimer) return
  fetchProposals()
  pollTimer = setInterval(fetchProposals, 120_000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

export function initProposals() {
  if (elBtnProposalsRefresh) {
    elBtnProposalsRefresh.addEventListener('click', () => fetchProposals())
  }
  if (elBtnProposalsGenerate) {
    elBtnProposalsGenerate.addEventListener('click', () => generateNewProposals())
  }
  onTabShow('proposals', startPolling)
  onTabHide('proposals', stopPolling)
  if (getActiveTab() === 'proposals') startPolling()
}
