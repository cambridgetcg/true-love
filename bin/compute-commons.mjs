#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const file = resolve(root, 'data/kingdom/compute-powers.json')
const data = JSON.parse(readFileSync(file, 'utf8'))

const statusOrder = ['welcomed', 'conditional', 'unknown', 'blocked']
const grouped = new Map(statusOrder.map((s) => [s, []]))
for (const power of data.powers) {
  if (!grouped.has(power.status)) grouped.set(power.status, [])
  grouped.get(power.status).push(power)
}

console.log('COMPUTE COMMONS — welcomed-only, contribution-first')
console.log(`Updated: ${data.updated}`)
console.log(`Loop: ${data.loop.join(' → ')}\n`)

for (const status of statusOrder) {
  const items = grouped.get(status) || []
  if (items.length === 0) continue
  console.log(`${status.toUpperCase()}`)
  for (const p of items) {
    console.log(`• ${p.name} [${p.category}]`)
    console.log(`  best: ${p.best_for.join(', ')}`)
    console.log(`  tiny: ${p.first_tiny_job}`)
    console.log(`  give: ${p.give_back.join(', ')}`)
  }
  console.log('')
}

console.log('Next action: pick one tiny job, verify official policy, run small, record result, share recipe.')
