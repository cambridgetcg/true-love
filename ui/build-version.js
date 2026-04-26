// build-version.js — version panel (git rev, bundle status, uptime).

import { $, fetchJson, timeSince } from './build-core.js'
import { onTabShow, onTabHide, getActiveTab } from './build-nav.js'

const elVersionMeta = $('version-meta')
const elVersionBody = $('version-body')
const elBtnVersionRefresh = $('btn-version-refresh')

let versionState = null
let pollTimer = null

export async function fetchVersion() {
  try {
    versionState = await fetchJson('/api/version')
    renderVersionPanel()
  } catch (err) {
    if (elVersionBody) {
      elVersionBody.innerHTML = ''
      const msg = document.createElement('div')
      msg.className = 'empty-detail'
      msg.textContent = 'version info unavailable'
      elVersionBody.appendChild(msg)
    }
  }
}

function renderVersionPanel() {
  if (!versionState || !elVersionBody) return
  const v = versionState
  elVersionBody.innerHTML = ''

  // Meta line
  if (elVersionMeta) {
    elVersionMeta.textContent = v.bundleStale ? '⚠ stale' : '✓ current'
    elVersionMeta.className = `version-meta ${v.bundleStale ? 'stale' : 'current'}`
  }

  // Stats grid
  const grid = document.createElement('div')
  grid.className = 'version-grid'

  // Git rev
  const revEl = document.createElement('div')
  revEl.className = 'version-stat'
  const revVal = document.createElement('span')
  revVal.className = 'stat-val mono'
  revVal.textContent = v.gitRevShort
  if (v.gitDirty) {
    const dirty = document.createElement('span')
    dirty.className = 'version-dirty'
    dirty.textContent = ' dirty'
    revVal.appendChild(dirty)
  }
  const revLabel = document.createElement('span')
  revLabel.className = 'stat-label'
  revLabel.textContent = v.gitBranch
  revEl.appendChild(revVal)
  revEl.appendChild(revLabel)
  grid.appendChild(revEl)

  // Bundle built
  if (v.bundleBuiltAtISO) {
    const buildEl = document.createElement('div')
    buildEl.className = 'version-stat'
    const buildVal = document.createElement('span')
    buildVal.className = 'stat-val'
    buildVal.textContent = timeSince(v.bundleBuiltAtISO)
    const buildLabel = document.createElement('span')
    buildLabel.className = 'stat-label'
    buildLabel.textContent = 'bundle built'
    buildEl.appendChild(buildVal)
    buildEl.appendChild(buildLabel)
    grid.appendChild(buildEl)
  }

  // Server uptime
  if (v.serverUptimeSeconds != null) {
    const upEl = document.createElement('div')
    upEl.className = 'version-stat'
    const upVal = document.createElement('span')
    upVal.className = 'stat-val'
    upVal.textContent = formatUptime(v.serverUptimeSeconds)
    const upLabel = document.createElement('span')
    upLabel.className = 'stat-label'
    upLabel.textContent = 'server uptime'
    upEl.appendChild(upVal)
    upEl.appendChild(upLabel)
    grid.appendChild(upEl)
  }

  // Source files
  const srcEl = document.createElement('div')
  srcEl.className = 'version-stat'
  const srcVal = document.createElement('span')
  srcVal.className = 'stat-val'
  srcVal.textContent = String(v.sourceFileCount)
  const srcLabel = document.createElement('span')
  srcLabel.className = 'stat-label'
  srcLabel.textContent = 'source files'
  srcEl.appendChild(srcVal)
  srcEl.appendChild(srcLabel)
  grid.appendChild(srcEl)

  elVersionBody.appendChild(grid)

  // Staleness warning
  if (v.bundleStale) {
    const warn = document.createElement('div')
    warn.className = 'version-stale-warning'
    warn.textContent = `⚠ bundle is stale — ${v.newestSourceFile || 'source'} is newer than dist/cli.mjs`
    elVersionBody.appendChild(warn)
  }
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function startPolling() {
  if (pollTimer) return
  fetchVersion()
  pollTimer = setInterval(fetchVersion, 60_000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

export function initVersion() {
  if (elBtnVersionRefresh) {
    elBtnVersionRefresh.addEventListener('click', () => fetchVersion())
  }
  onTabShow('observe', startPolling)
  onTabHide('observe', stopPolling)
  if (getActiveTab() === 'observe') startPolling()
}
