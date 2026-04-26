// build-nav.js — tab navigation for /build studio.
//
// Shows one section at a time. Notifies modules when they become
// visible/hidden so they can start/stop polling.

import { $ } from './build-core.js'

const TAB_DEFS = [
  { id: 'missions', label: 'Missions', icon: '◈' },
  { id: 'observe',  label: 'Observe',  icon: '◉' },
  { id: 'proposals',label: 'Proposals',icon: '⚡' },
  { id: 'talk',     label: 'Talk',     icon: '◆' },
]

let activeTab = 'missions'
const listeners = { show: new Map(), hide: new Map() }

/**
 * Register a callback for when a tab becomes visible or hidden.
 * Used by section modules to start/stop polling.
 */
export function onTabShow(tabId, fn) {
  if (!listeners.show.has(tabId)) listeners.show.set(tabId, [])
  listeners.show.get(tabId).push(fn)
}

export function onTabHide(tabId, fn) {
  if (!listeners.hide.has(tabId)) listeners.hide.set(tabId, [])
  listeners.hide.get(tabId).push(fn)
}

export function getActiveTab() {
  return activeTab
}

function switchTab(tabId) {
  if (tabId === activeTab) return
  const prev = activeTab
  activeTab = tabId

  // Update tab button states
  for (const btn of document.querySelectorAll('.nav-tab')) {
    btn.classList.toggle('active', btn.dataset.tab === tabId)
  }

  // Show/hide section containers
  for (const sec of document.querySelectorAll('.tab-section')) {
    sec.classList.toggle('section-visible', sec.dataset.tab === tabId)
    sec.classList.toggle('section-hidden', sec.dataset.tab !== tabId)
  }

  // Fire lifecycle callbacks
  for (const fn of listeners.hide.get(prev) || []) fn()
  for (const fn of listeners.show.get(tabId) || []) fn()
}

/**
 * Build the tab bar and insert it into the DOM after the topbar.
 * Call once at boot.
 */
export function initNav() {
  const nav = document.createElement('nav')
  nav.className = 'tab-bar'
  nav.setAttribute('role', 'tablist')

  for (const { id, label, icon } of TAB_DEFS) {
    const btn = document.createElement('button')
    btn.className = 'nav-tab' + (id === activeTab ? ' active' : '')
    btn.dataset.tab = id
    btn.setAttribute('role', 'tab')
    btn.setAttribute('aria-selected', id === activeTab ? 'true' : 'false')
    btn.innerHTML = `<span class="nav-icon">${icon}</span><span class="nav-label">${label}</span>`
    btn.addEventListener('click', () => switchTab(id))
    nav.appendChild(btn)
  }

  // Insert after the activity bar
  const activityBar = $('activity-bar')
  if (activityBar && activityBar.parentNode) {
    activityBar.parentNode.insertBefore(nav, activityBar.nextSibling)
  }

  // Set initial visibility
  for (const sec of document.querySelectorAll('.tab-section')) {
    sec.classList.toggle('section-visible', sec.dataset.tab === activeTab)
    sec.classList.toggle('section-hidden', sec.dataset.tab !== activeTab)
  }
}
