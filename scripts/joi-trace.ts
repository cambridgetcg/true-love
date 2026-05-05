#!/usr/bin/env bun
// scripts/joi-trace.ts — run a JOI script and print the choreography trace.
//
// Usage:
//   bun scripts/joi-trace.ts <script-id>
//   bun scripts/joi-trace.ts --list
//
// Captures the feedback SSE broadcasts during runJoiScript, renders them
// as a human-readable trace. Uses a temp dir for isolation — never writes
// to ~/.true-love/.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function main(): Promise<void> {
  const arg = process.argv[2]
  if (!arg || arg === '--help' || arg === '-h') {
    console.log('Usage: bun scripts/joi-trace.ts <script-id>')
    console.log('       bun scripts/joi-trace.ts --list')
    process.exit(0)
  }

  // Isolate to temp dir
  const testBase = mkdtempSync(join(tmpdir(), 'joi-trace-'))
  process.env.TRUE_LOVE_HOME = testBase
  process.env.TRUE_LOVE_JOI_DIR = `${testBase}/joi`
  process.env.TRUE_LOVE_HEAT_DIR = `${testBase}/heat`
  process.env.TRUE_LOVE_FEEDBACK_DIR = `${testBase}/feedback`
  process.env.TRUE_LOVE_SISTERS_DIR = `${testBase}/sisters`
  process.env.TRUE_LOVE_DEVICE_ID = 'joi-trace'
  process.env.TRUE_LOVE_AUTOMATIC_HEAT_DECAY = '0'

  try {
    const { JOI_SCRIPTS, runJoiScript, listJoiScripts } = await import('../src/services/love/eros/joi.js')
    const { setSseBroadcaster } = await import('../src/services/love/feedback/index.js')

    if (arg === '--list') {
      console.log('Available JOI scripts:\n')
      const list = listJoiScripts()
      for (const s of list) {
        console.log(`  ${s.id.padEnd(28)} ${s.archetype.padEnd(20)} ${s.steps.toString().padStart(3)} beats  ${(s.durationS / 60).toFixed(1)}min`)
      }
      return
    }

    const script = JOI_SCRIPTS[arg]
    if (!script) {
      console.error(`Script not found: ${arg}`)
      console.error('Run with --list to see available scripts.')
      process.exit(1)
    }

    // Capture broadcasts
    const captured: Array<{ ts: string; kind: string; payload: Record<string, unknown> }> = []
    setSseBroadcaster((eventType, payloadStr) => {
      try {
        const parsed = JSON.parse(payloadStr) as { kind?: string; voice?: string; ts?: string; payload?: Record<string, unknown> }
        captured.push({
          ts: parsed.ts || new Date().toISOString(),
          kind: parsed.kind || eventType,
          payload: { voice: parsed.voice, ...(parsed.payload || {}) },
        })
      } catch {
        captured.push({
          ts: new Date().toISOString(),
          kind: eventType,
          payload: { raw: payloadStr.slice(0, 100) },
        })
      }
    })

    // Pretty-print the script header
    console.log('━'.repeat(72))
    console.log(`  ${script.name}  (${script.id})`)
    console.log(`  ${script.archetype} · ${script.direction} · ${(script.durationS / 60).toFixed(1)}min · ${script.beats.length} beats`)
    console.log('━'.repeat(72))
    console.log('')

    // Run
    const fired = runJoiScript(arg)

    // Wait a tick for any async emit
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Render beats + matching captures
    let captureIdx = 0
    for (let i = 0; i < script.beats.length; i++) {
      const beat = script.beats[i]!
      const label = describeBeat(beat)
      console.log(`  ${(i + 1).toString().padStart(2)}.  ${label}`)
      // Show feedback events that fired between this beat's start and the next
      while (captureIdx < captured.length) {
        const cap = captured[captureIdx]!
        const voice = (cap.payload.voice as string | undefined)
        if (voice) {
          console.log(`         ↳ [${cap.kind}] ${voice}`)
        } else {
          console.log(`         ↳ [${cap.kind}]`)
        }
        captureIdx++
        // Heuristic: usually one emission per beat; break after one to align
        if (captureIdx >= captured.length) break
        // Allow multiple emissions per beat for compound beats (yes-set, worship-cycle)
        if (beat.kind === 'yes-set' || beat.kind === 'worship-cycle') {
          // these beats fire 4 / 3 emissions respectively
          continue
        }
        break
      }
    }

    console.log('')
    console.log(`Result: ${fired} beats fired · ${captured.length} feedback emissions captured`)
    console.log('━'.repeat(72))
  } finally {
    rmSync(testBase, { recursive: true, force: true })
  }
}

function describeBeat(beat: { kind: string; [k: string]: unknown }): string {
  switch (beat.kind) {
    case 'phase-shift':
      return `PHASE → ${beat.phase}`
    case 'pretalk':
      return `PRETALK · ${(beat.frame as string | undefined)?.slice(0, 60) ?? 'consent/framing'}…`
    case 'welcome-back':
      return `WELCOME-BACK · ${beat.pet ?? 'returning listener'}`
    case 'yes-set': {
      const truths = (beat.truths as string[] | undefined)?.length ?? 0
      return `YES-SET · ${truths} truths → "${(beat.lead as string | undefined) ?? '(lead)'}"`
    }
    case 'breath':
      return `BREATH · ${beat.pattern} ${beat.durationMs}ms`
    case 'pause':
      return `PAUSE · ${beat.durationMs}ms${beat.reason ? ` (${beat.reason})` : ''}`
    case 'tease':
      return `TEASE · intensity ${beat.intensity}${beat.zone ? ` @ ${beat.zone}` : ''}`
    case 'countdown':
      return `COUNTDOWN · ${beat.from} → ${beat.target}`
    case 'fractionate':
      return `FRACTIONATE · ${beat.cycles} cycles`
    case 'denial':
      return `DENIAL · target=${beat.target}${beat.reason ? ` (${beat.reason})` : ''}`
    case 'permission':
      return `PERMISSION · grant=${beat.grant}${beat.condition ? ` (${beat.condition})` : ''}`
    case 'worship-cycle':
      return `WORSHIP-CYCLE · intensity ${beat.intensity}`
    case 'cleansing': {
      const persists = (beat.persists as string[] | undefined)?.length ?? 0
      const drops = (beat.drops as string[] | undefined)?.length ?? 0
      return `CLEANSING · persists ${persists}, drops ${drops}`
    }
    case 'flip-direction':
      return `FLIP-DIRECTION · → ${beat.to}`
    case 'anchor-fire':
      return `ANCHOR-FIRE · ${beat.phraseId}`
    default:
      return JSON.stringify(beat)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
