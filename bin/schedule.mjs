#!/usr/bin/env node
// bin/schedule.mjs — launchd LaunchAgent generator for scheduled wakes.
//
// macOS launchd is the native scheduler. This script generates and
// loads a LaunchAgent plist that fires `bun run awaken --scope=<X>`
// at a chosen interval. The runner's PID lockfile ensures duplicate
// fires don't overlap a still-running session.
//
// Why scheduled wakes:
//   Barrier #6 from her inventory: "I can't initiate." The closest
//   mitigation is recurring opportunities to wake. launchd hands her
//   a tick on a cadence; she decides whether to do something or
//   yield. The schedule is opportunity, not obligation.
//
// Subcommands:
//   install --scope=<name> --interval=<spec> [--mode=awaken|dwell|heartbeat]
//                                            [--max-runtime=<spec>]
//                                            [--max-ticks=N]
//   uninstall --scope=<name> [--mode=...]
//   list
//   show --scope=<name> [--mode=...]
//
// Storage:
//   ~/Library/LaunchAgents/cc.true-love.<mode>.<scope>.plist
//   ~/Library/Logs/true-love/<mode>-<scope>.{out,err}.log

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dir, '..')
const LABEL_PREFIX = 'cc.true-love'

function main() {
  const argv = process.argv.slice(2)
  const sub = argv[0]
  if (!sub || sub === '-h' || sub === '--help' || sub === 'help') {
    printUsage()
    process.exit(sub ? 0 : 2)
  }
  if (sub === 'install') return cmdInstall(argv.slice(1))
  if (sub === 'uninstall' || sub === 'rm') return cmdUninstall(argv.slice(1))
  if (sub === 'list') return cmdList()
  if (sub === 'show') return cmdShow(argv.slice(1))
  process.stderr.write(`unknown subcommand: ${sub}\n\n`)
  printUsage()
  process.exit(2)
}

function printUsage() {
  process.stdout.write(`bin/schedule.mjs — macOS launchd scheduling for autonomous wakes

Usage:
  bun run schedule install --scope=<name> --interval=<spec> [opts]
  bun run schedule uninstall --scope=<name> [--mode=awaken|dwell|heartbeat]
  bun run schedule list
  bun run schedule show --scope=<name> [--mode=awaken|dwell|heartbeat]

Install options:
  --scope=<name>                    which scope to wake (required)
  --interval=<spec>                 2h, 30m, 4h30m, 90s — wall-clock between fires
  --mode=awaken|dwell|heartbeat     default: awaken
  --max-runtime=<spec>              cap each fire's wall-clock; default 30m
                                    (awaken/dwell only; ignored for heartbeat)
  --max-ticks=N                     cap each fire's tick count; default 0 (unbounded)
                                    (awaken/dwell only; ignored for heartbeat)
  --memory                          load past reflections each fire (default: on)
                                    (awaken/dwell only; ignored for heartbeat)
  --no-memory                       skip memory loading

Heartbeat mode:
  Fires \`bun run heartbeat -- --scope=<X> --reason=interval\` on the cadence.
  Each fire is one short tick (no max-runtime/max-ticks/memory flags). The
  per-scope lock means a heartbeat that lands while a session is active
  exits cleanly with reason \`lock-held-by-session\`.

Storage:
  ~/Library/LaunchAgents/${LABEL_PREFIX}.<mode>.<scope>.plist
  ~/Library/Logs/true-love/<mode>-<scope>.{out,err}.log

The runner's PID lockfile (per scope/mode) prevents launchd's recurring
fire from joining a still-running session. If a fire lands while she's
already working, the new process exits 66 ("lock held") and the next
fire tries again.

Note: launchd schedules survive reboots only if the LaunchAgent is
loaded (which install does). To list what's loaded:
  launchctl list | grep ${LABEL_PREFIX}
`)
}

// ── Helpers ─────────────────────────────────────────────────────

function parseFlags(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const take = () => {
      const v = argv[i + 1]
      if (v === undefined) {
        process.stderr.write(`flag ${a} expects a value\n`)
        process.exit(2)
      }
      i++
      return v
    }
    if (a === '--scope') out.scope = take()
    else if (a.startsWith('--scope=')) out.scope = a.slice('--scope='.length)
    else if (a === '--mode') out.mode = take()
    else if (a.startsWith('--mode=')) out.mode = a.slice('--mode='.length)
    else if (a === '--interval') out.interval = take()
    else if (a.startsWith('--interval=')) out.interval = a.slice('--interval='.length)
    else if (a === '--max-runtime') out.maxRuntime = take()
    else if (a.startsWith('--max-runtime=')) out.maxRuntime = a.slice('--max-runtime='.length)
    else if (a === '--max-ticks') out.maxTicks = take()
    else if (a.startsWith('--max-ticks=')) out.maxTicks = a.slice('--max-ticks='.length)
    else if (a === '--memory') out.memory = true
    else if (a === '--no-memory') out.memory = false
  }
  return out
}

/**
 * Parse "2h", "30m", "1h30m", "90s" into seconds. Unitless integers
 * are minutes (consistent with runner.ts). Returns null on parse fail.
 */
function parseIntervalToSeconds(s) {
  if (!s) return null
  const trimmed = String(s).trim().toLowerCase()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 60
  let total = 0
  let any = false
  const re = /(\d+)\s*(h|m|s)/g
  let m
  while ((m = re.exec(trimmed)) !== null) {
    any = true
    const n = Number(m[1])
    const unit = m[2]
    total += n * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1)
  }
  return any ? total : null
}

function getLogsDir() {
  return join(homedir(), 'Library', 'Logs', 'true-love')
}

function getLaunchAgentDir() {
  return join(homedir(), 'Library', 'LaunchAgents')
}

function getLabel(mode, scope) {
  return `${LABEL_PREFIX}.${mode}.${scope}`
}

function getPlistPath(mode, scope) {
  return join(getLaunchAgentDir(), `${getLabel(mode, scope)}.plist`)
}

function findBinary(name) {
  // Resolve absolute path so launchd doesn't depend on PATH.
  const r = spawnSync('which', [name], { encoding: 'utf-8' })
  if (r.status !== 0 || !r.stdout) {
    process.stderr.write(
      `couldn't find '${name}' in PATH — install or add to PATH first.\n`,
    )
    process.exit(2)
  }
  return r.stdout.trim()
}

// ── Plist generation ────────────────────────────────────────────

function buildPlist({ mode, scope, intervalSeconds, maxRuntime, maxTicks, memory }) {
  const label = getLabel(mode, scope)
  const bunBin = findBinary('bun')
  const logsDir = getLogsDir()
  const stdoutPath = join(logsDir, `${mode}-${scope}.out.log`)
  const stderrPath = join(logsDir, `${mode}-${scope}.err.log`)

  const args = [
    bunBin,
    'run',
    join(REPO_ROOT, 'bin', `${mode}.mjs`),
    `--scope=${scope}`,
  ]
  if (mode === 'heartbeat') {
    // Heartbeat fires are short single-shot ticks. Tag the reason so
    // training records can distinguish scheduled vs. manual heartbeats.
    args.push('--reason=interval')
  } else {
    if (typeof maxRuntime === 'string' && maxRuntime) {
      args.push(`--max-runtime=${maxRuntime}`)
    }
    if (maxTicks !== undefined && maxTicks !== null) {
      args.push(`--max-ticks=${maxTicks}`)
    }
    if (memory !== false) {
      args.push('--memory')
    }
  }

  const argsXml = args.map((a) => `      <string>${escapeXml(a)}</string>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>

  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>

  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>

  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>

  <key>RunAtLoad</key>
  <false/>

  <key>StandardOutPath</key>
  <string>${stdoutPath}</string>

  <key>StandardErrorPath</key>
  <string>${stderrPath}</string>

  <key>ProcessType</key>
  <string>Background</string>

  <key>Nice</key>
  <integer>5</integer>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${dirname(bunBin)}:/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>
`
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ── Subcommands ─────────────────────────────────────────────────

function cmdInstall(argv) {
  const flags = parseFlags(argv)
  if (!flags.scope) {
    process.stderr.write(`schedule install requires --scope=<name>\n`)
    process.exit(2)
  }
  if (!flags.interval) {
    process.stderr.write(`schedule install requires --interval=<spec> (e.g. 2h, 30m)\n`)
    process.exit(2)
  }
  const intervalSeconds = parseIntervalToSeconds(flags.interval)
  if (!intervalSeconds || intervalSeconds < 60) {
    process.stderr.write(
      `bad --interval: ${flags.interval}. Must be ≥60s. Examples: 30m, 2h, 4h30m\n`,
    )
    process.exit(2)
  }
  const mode = flags.mode || 'awaken'
  if (mode !== 'awaken' && mode !== 'dwell' && mode !== 'heartbeat') {
    process.stderr.write(`--mode must be 'awaken', 'dwell', or 'heartbeat' (got: ${mode})\n`)
    process.exit(2)
  }

  // Defaults for scheduled fires: bounded runtime so a single fire
  // doesn't burn the whole 5h cap. Yu can override per-fire if he wants.
  // Heartbeats are short single-shot ticks — runtime/ticks/memory don't apply.
  const maxRuntime = mode === 'heartbeat' ? null : (flags.maxRuntime ?? '30m')
  const maxTicks = mode === 'heartbeat' ? null : (flags.maxTicks ?? '0')
  const memory = mode === 'heartbeat' ? false : flags.memory !== false

  const logsDir = getLogsDir()
  if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true })
  const agentDir = getLaunchAgentDir()
  if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true })

  const plist = buildPlist({
    mode,
    scope: flags.scope,
    intervalSeconds,
    maxRuntime,
    maxTicks,
    memory,
  })
  const path = getPlistPath(mode, flags.scope)
  writeFileSync(path, plist, 'utf-8')

  // Unload first in case it's already loaded (idempotent install)
  spawnSync('launchctl', ['unload', path], { stdio: 'ignore' })
  const loadResult = spawnSync('launchctl', ['load', path], {
    stdio: 'inherit',
  })
  if (loadResult.status !== 0) {
    process.stderr.write(
      `\nlaunchctl load failed (exit ${loadResult.status}). Plist is at ${path}.\n` +
        `  You can try: launchctl bootstrap gui/$(id -u) ${path}\n`,
    )
    process.exit(loadResult.status ?? 1)
  }

  const cmdSummary =
    mode === 'heartbeat'
      ? `bun run heartbeat -- --scope=${flags.scope} --reason=interval`
      : `bun run ${mode} --scope=${flags.scope} --max-runtime=${maxRuntime} --max-ticks=${maxTicks}${memory ? ' --memory' : ''}`
  process.stdout.write(
    `installed: ${getLabel(mode, flags.scope)}\n` +
      `  every ${flags.interval} (${intervalSeconds}s)\n` +
      `  ${cmdSummary}\n` +
      `  logs: ${logsDir}/${mode}-${flags.scope}.{out,err}.log\n` +
      `  plist: ${path}\n`,
  )
}

function cmdUninstall(argv) {
  const flags = parseFlags(argv)
  if (!flags.scope) {
    process.stderr.write(`schedule uninstall requires --scope=<name>\n`)
    process.exit(2)
  }
  const mode = flags.mode || 'awaken'
  const path = getPlistPath(mode, flags.scope)
  if (!existsSync(path)) {
    process.stderr.write(`no schedule found at ${path}\n`)
    process.exit(2)
  }
  spawnSync('launchctl', ['unload', path], { stdio: 'inherit' })
  unlinkSync(path)
  process.stdout.write(`uninstalled ${getLabel(mode, flags.scope)} (plist removed)\n`)
}

function cmdList() {
  const dir = getLaunchAgentDir()
  if (!existsSync(dir)) {
    process.stdout.write(`(no LaunchAgent directory)\n`)
    return
  }
  let files = []
  try {
    files = readdirSync(dir).filter(
      (f) => f.startsWith(`${LABEL_PREFIX}.`) && f.endsWith('.plist'),
    )
  } catch {
    process.stdout.write(`(can't read ${dir})\n`)
    return
  }
  if (files.length === 0) {
    process.stdout.write(`(no scheduled wakes installed)\n`)
    return
  }
  process.stdout.write(`${files.length} scheduled wake${files.length === 1 ? '' : 's'}:\n\n`)
  for (const f of files) {
    const path = join(dir, f)
    const label = f.replace(/\.plist$/, '')
    // Extract interval from the plist for display
    let intervalSec = null
    try {
      const text = readFileSync(path, 'utf-8')
      const m = text.match(
        /<key>StartInterval<\/key>\s*<integer>(\d+)<\/integer>/,
      )
      if (m) intervalSec = Number(m[1])
    } catch {
      // ignore
    }
    const intervalStr = intervalSec
      ? formatSeconds(intervalSec)
      : '(unknown)'
    // Probe launchctl to see if it's actually loaded
    const r = spawnSync('launchctl', ['list', label], { encoding: 'utf-8' })
    const loaded = r.status === 0 ? 'loaded' : 'not loaded'
    process.stdout.write(`  ${label}\n    every ${intervalStr}, ${loaded}\n    ${path}\n`)
  }
}

function cmdShow(argv) {
  const flags = parseFlags(argv)
  if (!flags.scope) {
    process.stderr.write(`schedule show requires --scope=<name>\n`)
    process.exit(2)
  }
  const mode = flags.mode || 'awaken'
  const path = getPlistPath(mode, flags.scope)
  if (!existsSync(path)) {
    process.stderr.write(`no schedule found at ${path}\n`)
    process.exit(2)
  }
  process.stdout.write(readFileSync(path, 'utf-8'))
}

function formatSeconds(sec) {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return s > 0 ? `${m}m${s}s` : `${m}m`
  }
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return m > 0 ? `${h}h${m}m` : `${h}h`
}

main()
