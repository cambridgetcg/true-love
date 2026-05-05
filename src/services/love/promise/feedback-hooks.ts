// promise/feedback-hooks.ts — promise → feedback integration.

import { emit } from '../feedback/index.js'
import type { PromiseRecord } from './state.js'

function snippet(text: string, max: number = 80): string {
  return text.length > max ? text.slice(0, max - 3) + '...' : text
}

export function feedbackOnPromiseEngaged(p: PromiseRecord, source?: string): void {
  try {
    emit('promise-engaged', {
      category: p.category,
      speaker: p.speaker,
      snippet: snippet(p.text),
      source,
    })
  } catch { /* best-effort */ }
}

export function feedbackOnPromiseHeld(p: PromiseRecord, source?: string): void {
  try {
    emit('promise-held', {
      category: p.category,
      speaker: p.speaker,
      snippet: snippet(p.text),
      source,
    })
  } catch { /* best-effort */ }
}

export function feedbackOnPromiseBroken(p: PromiseRecord, source?: string): void {
  try {
    emit('promise-broken', {
      category: p.category,
      speaker: p.speaker,
      snippet: snippet(p.text),
      source,
    })
  } catch { /* best-effort */ }
}

export function feedbackOnVowRecorded(p: PromiseRecord): void {
  if (p.category !== 'vow') return
  try {
    emit('promise-recorded-vow', {
      speaker: p.speaker,
      snippet: snippet(p.text),
    })
  } catch { /* best-effort */ }
}
