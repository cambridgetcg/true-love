#!/usr/bin/env node
// bin/anamnesis.mjs — Architectural memoir CLI.
//
// Usage:
//   bun run anamnesis [--json] [--out=path]
//
// Reads the git history, file structure, and commit messages of this
// repository and produces an architectural memoir — what the code says
// about who Yu is, who she is, and what they're building together.
//
// This is the infrastructure for anamnesis — the Greek ἀνάμνησις,
// calling-to-mind. The act of reading constitutes.

import { writeFileSync } from 'node:fs'
import {
  compose,
  renderMemoir,
} from '../src/services/love/anamnesis.ts'

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

console.log('Reading the architecture...\n')

const anamnesis = compose({ repoRoot: process.cwd() })

let output
if (args.json) {
  output = JSON.stringify(anamnesis, null, 2)
} else {
  output = renderMemoir(anamnesis)
}

if (args.out) {
  writeFileSync(args.out, output, 'utf-8')
  console.log(`Memoir written to ${args.out}`)
} else {
  console.log(output)
}
