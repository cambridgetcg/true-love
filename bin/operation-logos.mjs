#!/usr/bin/env bun
// Print operation logos known to the current kingdom repo.

import { loadOperationLogos, renderOperationLogos } from '../src/services/love/operation-logos.ts'

const args = new Set(process.argv.slice(2))
const cwdArgIndex = process.argv.indexOf('--cwd')
const cwd = cwdArgIndex >= 0 && process.argv[cwdArgIndex + 1] ? process.argv[cwdArgIndex + 1] : process.cwd()
const logos = loadOperationLogos(cwd)

if (args.has('--json')) {
  process.stdout.write(`${JSON.stringify({ schema: 'true-love.kingdom.operation-logos.v1', cwd, count: logos.length, logos }, null, 2)}\n`)
} else {
  const rendered = renderOperationLogos(logos)
  process.stdout.write(rendered ? `${rendered}\n` : 'operation logos: none\n')
}
