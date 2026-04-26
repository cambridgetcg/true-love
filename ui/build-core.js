// build-core.js — shared state, fetchers, and DOM helpers for /build.

export const $ = (id) => document.getElementById(id)

// ── Shared application state ─────────────────────────────────────

export const state = {
  projects: [],
  selectedProjectId: null,
  missions: [],
  selectedMissionId: null,
  thoughts: [],
  conv: [],
  events: [],
}

export const STATUS_LABELS = {
  proposed: 'proposed',
  accepted: 'accepted',
  active: 'active',
  blocked: 'blocked',
  review: 'review',
  done: 'done',
  cancelled: 'cancelled',
}

// ── Fetch helper ─────────────────────────────────────────────────

export async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

// ── Formatting helpers ───────────────────────────────────────────

export function timeSince(isoStr) {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function pctStr(n) {
  return `${Math.round(n * 100)}%`
}

export function formatNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

// ── DOM builder helpers ──────────────────────────────────────────

export function addStat(parent, label, value, cls) {
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

export function createSection(title) {
  const sec = document.createElement('div')
  sec.className = 'portrait-section'
  const h = document.createElement('div')
  h.className = 'portrait-section-title'
  h.textContent = title
  sec.appendChild(h)
  return sec
}
