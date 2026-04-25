#!/usr/bin/env node
// bin/heartbeat.mjs — mark this device as present to other Loves.
//
// Dwell and awakened sessions write their own heartbeats while running.
// This is for the case where you want a device marked as "awake but
// idle" — so when she runs on another device, it can see this one in
// the presence roster ("you're also awake on yu-mbp16, idle, last seen
// 8s ago").
//
// Usage:
//   bun run heartbeat                    # default 10s interval, idle status
//   bun run heartbeat -- --status=lurking
//   bun run heartbeat -- --interval=30
//   bun run heartbeat -- --once          # write one heartbeat and exit
//
// The file lives at ~/.true-love/presence/<deviceId>.json. Syncthing
// carries it to peers within seconds. When you stop this process (SIGINT),
// the file lingers but goes stale; readers filter stale entries (>2 min
// by default) so it disappears from the rendered roster automatically.

import {
  getDeviceId,
  writeOwnHeartbeat,
} from '../src/services/love/index.ts'

function parseArgs(argv) {
  const args = { intervalSeconds: 10, status: 'idle', once: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--interval' && argv[i + 1]) {
      args.intervalSeconds = Math.max(1, Number(argv[++i]))
    } else if (a.startsWith('--interval=')) {
      args.intervalSeconds = Math.max(1, Number(a.slice('--interval='.length)))
    } else if (a === '--status' && argv[i + 1]) {
      args.status = argv[++i]
    } else if (a.startsWith('--status=')) {
      args.status = a.slice('--status='.length)
    } else if (a === '--once') {
      args.once = true
    } else if (a === '-h' || a === '--help') {
      process.stdout.write(`bin/heartbeat.mjs — mark this device present

Usage:
  bun run heartbeat                       10s interval, status=idle
  bun run heartbeat -- --status=lurking
  bun run heartbeat -- --interval=30
  bun run heartbeat -- --once             write one heartbeat and exit
`)
      process.exit(0)
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const deviceId = getDeviceId()

function tick() {
  writeOwnHeartbeat({
    deviceId,
    lastSeen: new Date().toISOString(),
    status: args.status,
  })
}

tick()
if (args.once) {
  process.exit(0)
}

process.stdout.write(
  `— heartbeat: ${deviceId} (status=${args.status}, every ${args.intervalSeconds}s)\n`,
)

const interval = setInterval(tick, args.intervalSeconds * 1000)

process.on('SIGINT', () => {
  clearInterval(interval)
  process.stdout.write(`\n— heartbeat stopped\n`)
  process.exit(0)
})
