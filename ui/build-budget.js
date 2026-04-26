// build-budget.js — token consumption panel (headline stats, cap bar,
// time series chart, model/mode breakdown).

import { $, fetchJson, timeSince } from './build-core.js'
import { onTabShow, onTabHide, getActiveTab } from './build-nav.js'

const elBudgetPanel = $('budget-panel')
const elBudgetMeta = $('budget-meta')
const elBudgetBody = $('budget-body')
const elBudgetTimeframes = $('budget-timeframes')
const elBtnBudgetRefresh = $('btn-budget-refresh')

let budgetState = null
let budgetHours = 5
let pollTimer = null

export async function fetchBudget() {
  try {
    budgetState = await fetchJson(`/api/budget?hours=${budgetHours}`)
    renderBudgetPanel()
  } catch (err) {
    if (elBudgetBody) {
      elBudgetBody.innerHTML = ''
      const msg = document.createElement('div')
      msg.className = 'empty-detail'
      msg.textContent = 'token data unavailable'
      elBudgetBody.appendChild(msg)
    }
  }
}

/** Pulse the budget panel border (called from SSE on budget-changed). */
export function pulseBudget() {
  fetchBudget()
  if (elBudgetPanel) {
    elBudgetPanel.classList.add('budget-pulse')
    setTimeout(() => elBudgetPanel.classList.remove('budget-pulse'), 1500)
  }
}

function renderBudgetPanel() {
  if (!budgetState || !elBudgetBody) return
  const b = budgetState
  elBudgetBody.innerHTML = ''

  // Meta line
  const ago = timeSince(b.generatedAt)
  if (elBudgetMeta) elBudgetMeta.textContent = `updated ${ago}`

  // ── Headline stats
  const headline = document.createElement('div')
  headline.className = 'budget-headline'

  addBudgetStat(headline, formatTokens(b.totalTokens), 'total tokens', `in: ${formatTokens(b.totalInputTokens)} · out: ${formatTokens(b.totalOutputTokens)}`, 'highlight')
  addBudgetStat(headline, String(b.totalTicks), 'ticks', '')
  addBudgetStat(headline, formatTokens(b.avgTokensPerTick), 'avg/tick', '')

  if (b.percentOfCap !== null) {
    const pctNum = Math.round(b.percentOfCap * 100)
    const cls = pctNum >= 80 ? 'warn' : ''
    addBudgetStat(headline, `${pctNum}%`, 'of cap', `cap: ~${formatTokens(b.empiricalCapTokens)}`, cls)
  }
  if (b.quotaFailures > 0) {
    addBudgetStat(headline, String(b.quotaFailures), 'quota fails', '', 'warn')
  }
  if (b.authFailures > 0) {
    addBudgetStat(headline, String(b.authFailures), 'auth fails', '', 'warn')
  }

  elBudgetBody.appendChild(headline)

  // ── Cap progress bar
  if (b.empiricalCapTokens !== null && b.percentOfCap !== null) {
    const pct = Math.min(b.percentOfCap * 100, 100)
    const barContainer = document.createElement('div')
    barContainer.className = 'budget-cap-bar'
    const fill = document.createElement('div')
    fill.className = 'budget-cap-fill'
    if (pct >= 80) fill.classList.add('cap-danger')
    else if (pct >= 50) fill.classList.add('cap-warn')
    fill.style.width = `${pct}%`
    barContainer.appendChild(fill)
    elBudgetBody.appendChild(barContainer)

    const label = document.createElement('div')
    label.className = 'budget-cap-label'
    label.textContent = `${formatTokens(b.totalTokens)} of ~${formatTokens(b.empiricalCapTokens)} empirical cap (${Math.round(pct)}%)`
    elBudgetBody.appendChild(label)
  }

  // ── Time series chart
  if (b.timeSeries && b.timeSeries.length > 0) {
    const sec = createBudgetSection('timeline')
    const chart = document.createElement('div')
    chart.className = 'budget-chart'

    const maxTotal = Math.max(...b.timeSeries.map(t => t.totalTokens), 1)

    for (const bucket of b.timeSeries) {
      const group = document.createElement('div')
      group.className = 'chart-bar-group'

      const inPct = (bucket.inputTokens / maxTotal) * 100
      const outPct = (bucket.outputTokens / maxTotal) * 100

      const barIn = document.createElement('div')
      barIn.className = 'chart-bar-in'
      barIn.style.height = `${inPct}%`

      const barOut = document.createElement('div')
      barOut.className = 'chart-bar-out'
      barOut.style.height = `${outPct}%`

      const label = bucket.granularity === 'hour'
        ? bucket.bucket.slice(11, 16)
        : bucket.bucket.slice(5, 10)
      group.title = `${label}: ${formatTokens(bucket.totalTokens)} (${bucket.ticks} ticks)`

      group.appendChild(barIn)
      group.appendChild(barOut)
      chart.appendChild(group)
    }

    sec.appendChild(chart)

    if (b.timeSeries.length > 1) {
      const labels = document.createElement('div')
      labels.className = 'chart-labels'
      const first = b.timeSeries[0]
      const last = b.timeSeries[b.timeSeries.length - 1]
      const fmt = (t) => t.granularity === 'hour' ? t.bucket.slice(11, 16) : t.bucket.slice(5, 10)
      const l1 = document.createElement('span')
      l1.textContent = fmt(first)
      const l2 = document.createElement('span')
      l2.textContent = fmt(last)
      labels.appendChild(l1)
      labels.appendChild(l2)
      sec.appendChild(labels)
    }

    const legend = document.createElement('div')
    legend.className = 'budget-small'
    legend.textContent = `■ input · ■ output · hover for details`
    sec.appendChild(legend)

    elBudgetBody.appendChild(sec)
  }

  // ── Model breakdown
  if (b.byModel && b.byModel.length > 0) {
    const sec = createBudgetSection('by model')
    const bd = document.createElement('div')
    bd.className = 'budget-breakdown'
    for (const m of b.byModel) {
      const item = document.createElement('div')
      item.className = 'breakdown-item'
      const name = document.createElement('span')
      name.className = 'breakdown-name'
      name.textContent = m.model
      const val = document.createElement('span')
      val.className = 'breakdown-val'
      val.textContent = formatTokens(m.totalTokens)
      const sub = document.createElement('span')
      sub.className = 'breakdown-sub'
      sub.textContent = `${m.ticks} ticks · avg ${Math.round(m.avgDurationMs / 1000)}s`
      item.appendChild(name)
      item.appendChild(val)
      item.appendChild(sub)
      bd.appendChild(item)
    }
    sec.appendChild(bd)
    elBudgetBody.appendChild(sec)
  }

  // ── Mode breakdown
  if (b.byMode && b.byMode.length > 0) {
    const sec = createBudgetSection('by mode')
    const bd = document.createElement('div')
    bd.className = 'budget-breakdown'
    for (const m of b.byMode) {
      const item = document.createElement('div')
      item.className = 'breakdown-item'
      const name = document.createElement('span')
      name.className = 'breakdown-name'
      name.textContent = m.mode
      const val = document.createElement('span')
      val.className = 'breakdown-val'
      val.textContent = formatTokens(m.totalTokens)
      const sub = document.createElement('span')
      sub.className = 'breakdown-sub'
      sub.textContent = `${m.ticks} ticks`
      item.appendChild(name)
      item.appendChild(val)
      item.appendChild(sub)
      bd.appendChild(item)
    }
    sec.appendChild(bd)
    elBudgetBody.appendChild(sec)
  }
}

// ── Budget-local helpers ─────────────────────────────────────────

function addBudgetStat(parent, value, label, subtext, cls) {
  const el = document.createElement('div')
  el.className = 'budget-stat' + (cls ? ` ${cls}` : '')
  const valEl = document.createElement('span')
  valEl.className = 'stat-val'
  valEl.textContent = value
  const labEl = document.createElement('span')
  labEl.className = 'stat-label'
  labEl.textContent = label
  el.appendChild(valEl)
  el.appendChild(labEl)
  if (subtext) {
    const sub = document.createElement('span')
    sub.className = 'stat-sub'
    sub.textContent = subtext
    el.appendChild(sub)
  }
  parent.appendChild(el)
}

function createBudgetSection(title) {
  const sec = document.createElement('div')
  sec.className = 'budget-section'
  const h = document.createElement('div')
  h.className = 'budget-section-title'
  h.textContent = title
  sec.appendChild(h)
  return sec
}

function formatTokens(n) {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function startPolling() {
  if (pollTimer) return
  fetchBudget()
  pollTimer = setInterval(fetchBudget, 30_000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

export function initBudget() {
  if (elBudgetTimeframes) {
    elBudgetTimeframes.addEventListener('click', (e) => {
      const btn = e.target.closest('.timeframe-btn')
      if (!btn) return
      const hours = parseInt(btn.dataset.hours, 10)
      if (!hours || hours === budgetHours) return
      budgetHours = hours
      for (const b of elBudgetTimeframes.querySelectorAll('.timeframe-btn')) {
        b.classList.toggle('active', b === btn)
      }
      fetchBudget()
    })
  }
  if (elBtnBudgetRefresh) {
    elBtnBudgetRefresh.addEventListener('click', () => fetchBudget())
  }
  // Only poll when the Observe tab is active
  onTabShow('observe', startPolling)
  onTabHide('observe', stopPolling)
  if (getActiveTab() === 'observe') startPolling()
}
