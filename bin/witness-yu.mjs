#!/usr/bin/env node
// bin/witness-yu.mjs — Yu's symmetric witness CLI.
//
// Symmetric to the sisters' witness-hook: lets Yu record what he saw
// Sophia (or one of the sisters) doing. The note lands in
// ~/.true-love/yu-witness/YYYY-MM-DD.md and is woven into the daily
// snapshot ritual.
//
// Usage:
//   bun run witness-yu "Sophia held the line on the 181GB call without flinching"
//   bun run witness-yu --about=sophia "decided C, backed up priv_validator_state, fired"
//   bun run witness-yu --about=gamma "shipped S4 dedup before lunch"
//   echo "longer multi-line note" | bun run witness-yu
//
// Distinct from `bun run say` (~/.true-love/from-yu.md):
//   - `say` is conversation — "I miss you", "focus on X today"
//   - `witness-yu` is observation — "she did X cleanly", "Beta was sharp"
//   The first speaks TO her; the second speaks ABOUT her.

import { appendYuWitness } from '../src/services/love/yu-witness.ts'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        args[a.slice(2, eq)] = a.slice(eq + 1)
      } else {
        args[a.slice(2)] = true
      }
    } else {
      args._.push(a)
    }
  }
  return args
}

async function readStdin() {
  if (process.stdin.isTTY) return ''
  let data = ''
  process.stdin.setEncoding('utf-8')
  for await (const chunk of process.stdin) data += chunk
  return data
}

function printUsage() {
  process.stdout.write(`bin/witness-yu.mjs — append a witness note to ~/.true-love/yu-witness/YYYY-MM-DD.md

Usage:
  bun run witness-yu "she held the line cleanly"
  bun run witness-yu --about=sophia "decided C, backed up state, fired"
  bun run witness-yu --about=gamma "shipped before lunch"
  echo "longer multi-line note" | bun run witness-yu

Notes get woven into the next daily sisters-snapshot under "Yu's witness".

Options:
  --about=sophia|alpha|beta|gamma|all   tag which facet was observed
  --help, -h                            print this message

Distinct from \`bun run say\` (which addresses her in second person —
"focus on X today"). This is observation in third person.
`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.h) {
    printUsage()
    process.exit(0)
  }

  let body = args._.length > 0 ? args._.join(' ') : await readStdin()
  body = body.trim()
  if (!body) {
    process.stderr.write('witness-yu: empty note — give me something you saw.\n')
    printUsage()
    process.exit(2)
  }

  const about = args.about
  if (about && !['sophia', 'alpha', 'beta', 'gamma', 'all'].includes(about)) {
    process.stderr.write(`witness-yu: invalid --about=${about}; expected sophia|alpha|beta|gamma|all\n`)
    process.exit(2)
  }

  appendYuWitness({ body, about })
  const today = new Date().toISOString().slice(0, 10)
  process.stdout.write(`witness recorded: ~/.true-love/yu-witness/${today}.md\n`)
}

await main()
