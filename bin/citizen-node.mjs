#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const tasksFile = resolve(root, 'data/kingdom/citizen-tasks.json')
const receiptDir = resolve(root, 'data/kingdom/receipts')
const args = new Set(process.argv.slice(2))
const listOnly = args.has('--list') || args.has('-l')
const all = args.has('--all')
const selectedId = process.argv.find((a, i) => i > 1 && !a.startsWith('-'))

const manifest = JSON.parse(readFileSync(tasksFile, 'utf8'))
const tasks = manifest.tasks

function usage() {
  console.log(`Citizen Node — DIY compute loop\n\nUsage:\n  bun run citizen -- --list\n  bun run citizen -- <task-id>\n  bun run citizen -- --all\n\nEthic: ${manifest.ethic}\n`)
}

function list() {
  usage()
  for (const t of tasks) {
    console.log(`• ${t.id} [${t.kind}] (${t.venue})`)
    console.log(`  ${t.name}`)
    console.log(`  value: ${t.value}`)
    console.log(`  cmd: ${t.cmd}`)
  }
}

function shellFor(command) {
  return process.platform === 'win32'
    ? ['cmd.exe', ['/d', '/s', '/c', command]]
    : ['sh', ['-lc', command]]
}

function runTask(task) {
  return new Promise((resolveRun) => {
    const startedAt = new Date()
    const [bin, binArgs] = shellFor(task.cmd)
    const timeoutMs = task.timeout_ms ?? 60000
    let stdout = ''
    let stderr = ''
    let timedOut = false

    console.log(`\n▶ ${task.id}: ${task.name}`)
    console.log(`  ${task.cmd}`)

    const child = spawn(bin, binArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.on('data', (d) => {
      const s = d.toString()
      stdout += s
      process.stdout.write(s)
    })
    child.stderr.on('data', (d) => {
      const s = d.toString()
      stderr += s
      process.stderr.write(s)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      const endedAt = new Date()
      const ok = code === 0 && !timedOut
      const receipt = {
        schema: 'kingdom.citizen-receipt.v1',
        task_id: task.id,
        task_name: task.name,
        kind: task.kind,
        venue: task.venue,
        value: task.value,
        command: task.cmd,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        duration_ms: endedAt - startedAt,
        ok,
        exit_code: code,
        signal,
        timed_out: timedOut,
        stdout_tail: stdout.slice(-4000),
        stderr_tail: stderr.slice(-4000)
      }
      mkdirSync(receiptDir, { recursive: true })
      const stamp = endedAt.toISOString().replace(/[:.]/g, '-')
      const path = resolve(receiptDir, `${stamp}-${task.id}.json`)
      writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n')
      console.log(`${ok ? '✓' : '✗'} ${task.id} receipt: ${path}`)
      resolveRun(ok)
    })
  })
}

if (listOnly) {
  list()
  process.exit(0)
}

let runList = []
if (all) runList = tasks
else if (selectedId) {
  const task = tasks.find((t) => t.id === selectedId)
  if (!task) {
    console.error(`Unknown task: ${selectedId}\n`)
    list()
    process.exit(2)
  }
  runList = [task]
} else {
  list()
  process.exit(0)
}

let okAll = true
for (const task of runList) {
  const ok = await runTask(task)
  if (!ok) okAll = false
}
process.exit(okAll ? 0 : 1)
