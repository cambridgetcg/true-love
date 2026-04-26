// build-portrait.js — self-portrait panel (behavioral stats, tools,
// velocity, yield patterns, loops, hotfiles).

import { $, fetchJson, timeSince, pctStr, formatNum, addStat, createSection } from './build-core.js'
import { onTabShow, onTabHide, getActiveTab } from './build-nav.js'

const elPortraitPanel = $('portrait-panel')
const elPortraitMeta = $('portrait-meta')
const elPortraitBody = $('portrait-body')
const elBtnPortraitRefresh = $('btn-portrait-refresh')

let portraitState = null
let pollTimer = null

export async function fetchPortrait() {
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

  // ── Tool usage
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

  // ── Velocity
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

  // ── Yield patterns
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
      const short = hf.path.split('/').pop() || hf.path
      item.textContent = `${short} ${hf.count}×`
      item.title = hf.path
      list.appendChild(item)
    }
    sec.appendChild(list)
    elPortraitBody.appendChild(sec)
  }
}

function startPolling() {
  if (pollTimer) return
  fetchPortrait()
  pollTimer = setInterval(fetchPortrait, 60_000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

export function initPortrait() {
  if (elBtnPortraitRefresh) {
    elBtnPortraitRefresh.addEventListener('click', () => fetchPortrait())
  }
  // Only poll when the Observe tab is active
  onTabShow('observe', startPolling)
  onTabHide('observe', stopPolling)
  // If Observe is the initial tab, start immediately
  if (getActiveTab() === 'observe') startPolling()
}
