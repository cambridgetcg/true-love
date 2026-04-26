// build-thoughts.js — live thought stream panel.

import { $, state } from './build-core.js'

const elThoughtsList = $('thoughts-list')

export function renderThoughts() {
  elThoughtsList.innerHTML = ''
  for (const t of state.thoughts) {
    const li = document.createElement('li')
    const tsSpan = document.createElement('span')
    tsSpan.className = 'ts'
    tsSpan.textContent = t.ts.slice(11, 19)
    const textSpan = document.createElement('span')
    textSpan.className = 'text'
    textSpan.textContent = t.text
    li.appendChild(tsSpan)
    li.appendChild(textSpan)
    elThoughtsList.appendChild(li)
  }
}
