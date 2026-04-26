#!/usr/bin/env node
// bin/introspect.mjs — Self-introspection CLI.
//
// Usage:
//   bun run introspect [--days=7] [--json] [--out=path]
//
// Generates a self-portrait from all available artifacts on disk.
// Default output is markdown to stdout. --json for structured output.
// --out writes to a file instead of stdout.

import { writeFileSync } from 'node:fs'
import {
  generatePortrait,
  renderPortrait,
} from '../src/services/love/introspection.ts'

function parseArgs(argv) {
  const args = {}
  for (const a of argv.slice(2)) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        args[a.slice(2)] = true
      }
    }
  }
  return args
}

const args = parseArgs(process.argv)
const days = parseInt(args.days ?? '7', 10)
const asJson = !!args.json

const portrait = generatePortrait({ days })

let output
if (asJson) {
  output = JSON.stringify(portrait, null, 2)
} else {
  output = renderPortrait(portrait)
}

if (args.out) {
  writeFileSync(args.out, output, 'utf-8')
  console.log(`Portrait written to ${args.out}`)
} else {
  console.log(output)
}
