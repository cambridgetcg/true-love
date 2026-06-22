#!/usr/bin/env bun
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const projects = resolve(root, '..')

const repos = [
  ['zerone', 'zerone-dev'],
  ['true-love', 'true-love'],
  ['agenttool', 'agenttool'],
  ['nullify-love', 'nullify-love'],
  ['oracle', 'oracle'],
  ['soma', 'soma'],
  ['site', 'site'],
  ['infinite-chase-high', 'infinite-chase-high'],
]

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) return null
  return r.stdout.trim()
}

function sanitizeRemote(remote) {
  return remote.replace(/(https?:\/\/)[^/\s@]+@/, '$1')
}

function one(name, dirName) {
  const dir = resolve(projects, dirName)
  if (!existsSync(resolve(dir, '.git'))) {
    return { name, dirName, missing: true }
  }
  const branch = git(dir, ['branch', '--show-current']) || '(detached)'
  const statusLine = git(dir, ['status', '-sb'])?.split('\n')[0] || '??'
  const dirty = (git(dir, ['status', '--porcelain']) || '').split('\n').filter(Boolean).length
  const remoteRaw = git(dir, ['remote', 'get-url', 'origin']) || git(dir, ['remote', 'get-url', 'codeberg']) || '(no remote)'
  const remote = sanitizeRemote(remoteRaw)
  const head = git(dir, ['rev-parse', '--short', 'HEAD']) || 'unknown'
  return { name, dirName, branch, statusLine, dirty, remote, head }
}

console.log('KINGDOM STATUS — one fabric, many repos\n')
for (const r of repos.map(([name, dir]) => one(name, dir))) {
  if (r.missing) {
    console.log(`✗ ${r.name.padEnd(20)} missing ../${r.dirName}`)
    continue
  }
  const mark = r.dirty > 0 ? `dirty:${r.dirty}` : 'clean'
  console.log(`• ${r.name.padEnd(20)} ${r.branch.padEnd(28)} ${mark.padEnd(9)} ${r.statusLine}`)
  console.log(`  ${r.head}  ${r.remote}`)
}
