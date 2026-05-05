// build-heart.js — GOOD HEART module visibility panel.
//
// Polls /api/heart/status when 'observe' tab is visible. Renders:
//   - Status indicator (aligned / aligned-mostly / mixed / concern / idle)
//   - Counts: aligned vs broken in last 7d
//   - Last concern timestamp + age
//   - Recent check feed (newest first, capped at 20 in UI)
//
// Per docs/sophia/good-heart-plan.md §4.I.

import { $, fetchJson } from './build-core.js'
import { onTabShow, onTabHide, getActiveTab } from './build-nav.js'

const elBody = $('heart-body')
const elMeta = $('heart-meta')
const elBtn = $('btn-heart-refresh')
let timer = null

const STATUS_ICON = {
  idle: '⚪',
  aligned: '🟢',
  'aligned-mostly': '🟢',
  mixed: '🟡',
  concern: '🔴',
}

function fmtAge(min) {
  if (min == null) return '—'
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function questionFromSource(source) {
  // Source format for broken: 'heart:<question>:<actionKind>'
  // Source format for aligned: '<actionKind>'
  if (source && source.startsWith('heart:')) {
    const parts = source.split(':')
    return parts[1] || 'unknown'
  }
  return null
}

function actionKindFromSource(source) {
  if (!source) return ''
  if (source.startsWith('heart:')) {
    const parts = source.split(':')
    return parts.slice(2).join(':') || ''
  }
  return source
}

export async function fetchHeart() {
  try {
    const s = await fetchJson('/api/heart/status')
    render(s)
  } catch {
    if (elBody) {
      elBody.innerHTML = ''
      const msg = document.createElement('div')
      msg.className = 'empty-detail'
      msg.textContent = 'heart status unavailable'
      elBody.appendChild(msg)
    }
  }
}

function render(s) {
  if (!elBody) return

  elBody.innerHTML = ''

  // Header summary line
  const summary = document.createElement('div')
  summary.className = 'heart-summary'
  const dot = document.createElement('span')
  dot.className = 'heart-dot'
  dot.textContent = STATUS_ICON[s.status] || '⚪'
  const text = document.createElement('span')
  text.className = 'heart-summary-text'
  text.textContent = s.oneLine || 'no heart-checks recorded yet'
  summary.appendChild(dot)
  summary.appendChild(text)
  elBody.appendChild(summary)

  // Counts row
  if (s.total > 0) {
    const counts = document.createElement('div')
    counts.className = 'heart-counts mono'
    const alignedSpan = document.createElement('span')
    alignedSpan.className = 'heart-count-aligned'
    alignedSpan.textContent = `aligned ${s.aligned}`
    const brokenSpan = document.createElement('span')
    brokenSpan.className = 'heart-count-broken'
    brokenSpan.textContent = `concern ${s.broken}`
    counts.appendChild(alignedSpan)
    counts.appendChild(document.createTextNode(' · '))
    counts.appendChild(brokenSpan)
    if (s.lastConcernAt) {
      const lastConcern = document.createElement('span')
      lastConcern.className = 'heart-last'
      const ageMin = Math.floor(
        (Date.now() - new Date(s.lastConcernAt).getTime()) / 60_000,
      )
      lastConcern.textContent = ` · last concern ${fmtAge(ageMin)} ago`
      counts.appendChild(lastConcern)
    }
    elBody.appendChild(counts)
  }

  // Recent feed (newest first, top 20)
  if (Array.isArray(s.recent) && s.recent.length > 0) {
    const feed = document.createElement('ul')
    feed.className = 'heart-feed'
    for (const e of s.recent.slice(0, 20)) {
      const li = document.createElement('li')
      li.className = `heart-entry heart-entry-${e.kind}`
      const icon = document.createElement('span')
      icon.className = 'heart-entry-icon'
      icon.textContent = e.kind === 'aligned' ? '✓' : '⚠'
      const time = document.createElement('span')
      time.className = 'heart-entry-time mono'
      time.textContent = fmtAge(e.ageMin)
      const detail = document.createElement('span')
      detail.className = 'heart-entry-detail mono'
      const question = questionFromSource(e.source)
      const action = actionKindFromSource(e.source)
      detail.textContent = question
        ? `${question} · ${action}`
        : action
      li.appendChild(icon)
      li.appendChild(time)
      li.appendChild(detail)
      feed.appendChild(li)
    }
    elBody.appendChild(feed)
  }

  // Meta in header
  if (elMeta) {
    elMeta.textContent =
      s.total === 0 ? 'idle' : `${s.aligned}/${s.total} aligned`
    elMeta.className = `heart-meta status-${s.status}`
  }
}

function startPoll() {
  if (timer) return
  fetchHeart()
  timer = setInterval(fetchHeart, 30_000)
}
function stopPoll() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function initHeart() {
  if (elBtn) elBtn.addEventListener('click', fetchHeart)
  onTabShow('observe', startPoll)
  onTabHide('observe', stopPoll)
  if (getActiveTab() === 'observe') startPoll()
}
