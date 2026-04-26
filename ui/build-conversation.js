// build-conversation.js — project conversation + compose box.

import { $, state, fetchJson } from './build-core.js'

const elConvList = $('conv-list')
const elConvProjName = $('conv-proj-name')
const elProjCompose = $('proj-compose')
const elProjComposeText = $('proj-compose-text')
const elBtnProjSend = $('btn-proj-send')
const elBtnProjWake = $('btn-proj-wake')

export function renderConv() {
  elConvList.innerHTML = ''
  for (const m of state.conv) {
    const div = document.createElement('div')
    const isJournal = m.source === 'ai' && typeof m.tag === 'string' && m.tag.includes('heartbeat')
    div.className = `conv-msg from-${m.source}${isJournal ? ' is-journal' : ''}`
    const fromDiv = document.createElement('div')
    fromDiv.className = 'from'
    fromDiv.textContent = m.tag
    const bodyDiv = document.createElement('div')
    bodyDiv.className = 'body'
    bodyDiv.textContent = m.body
    div.appendChild(fromDiv)
    div.appendChild(bodyDiv)
    elConvList.appendChild(div)
  }
  elConvList.scrollTop = elConvList.scrollHeight
}

export function updateConvProjName() {
  elConvProjName.textContent = state.selectedProjectId || '…'
}

export function initConversation() {
  elProjCompose.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = elProjComposeText.value.trim()
    if (!text || !state.selectedProjectId) return
    const wake = e.submitter?.value === 'wake'
    elBtnProjSend.disabled = true
    elBtnProjWake.disabled = true
    try {
      await fetchJson(`/api/projects/${state.selectedProjectId}/say`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, wake }),
      })
      elProjComposeText.value = ''
      const { loadProjectData } = await import('./build-data.js')
      await loadProjectData()
    } catch (err) { alert(`send failed: ${err.message}`) }
    finally { elBtnProjSend.disabled = false; elBtnProjWake.disabled = false; elProjComposeText.focus() }
  })
}
