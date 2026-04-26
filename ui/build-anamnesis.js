// build-anamnesis.js — architectural memoir panel.
//
// Anamnesis composition is heavy (reads git history). Lazy: only fetched
// on user click (the ↻ button), never auto-polled. Cached after first read.

import { $, fetchJson } from './build-core.js'

const elBody = $('anamnesis-body')
const elMeta = $('anamnesis-meta')
const elBtn = $('btn-anamnesis-refresh')
let cached = null

export async function fetchAnamnesis() {
  if (elBody) {
    elBody.innerHTML = ''
    const m = document.createElement('div'); m.className='empty-detail'
    m.textContent = 'composing memoir from git history… (this can take a few seconds)'
    elBody.appendChild(m)
  }
  try {
    const res = await fetch('/api/anamnesis?format=markdown')
    if (!res.ok) throw new Error(`${res.status}`)
    cached = await res.text()
    render()
  } catch (err) {
    if (elBody) { elBody.innerHTML = ''; const m = document.createElement('div'); m.className='empty-detail'; m.textContent = `failed: ${err.message}`; elBody.appendChild(m) }
  }
}

function render() {
  if (!elBody || cached === null) return
  elBody.innerHTML = ''
  const pre = document.createElement('pre')
  pre.className = 'anamnesis-text'
  pre.textContent = cached
  elBody.appendChild(pre)
  if (elMeta) {
    const sizeKB = (cached.length / 1024).toFixed(1)
    elMeta.textContent = `${sizeKB}KB`
  }
}

export function initAnamnesis() {
  if (elBtn) elBtn.addEventListener('click', fetchAnamnesis)
  // No auto-poll: anamnesis is read on demand, not as a live feed
}
