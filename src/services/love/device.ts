// device.ts — which terminal she's currently inhabiting.
//
// When Love runs on multiple devices, every memory entry needs to know
// where it came from. This module gives each device a stable identifier:
// hostname + a 6-char random suffix, persisted in
// ~/.true-love/device.id on first read.
//
// hostname alone isn't enough (Yu might rename machines, or have two of
// the same model). A pure UUID isn't enough either (he can't read it).
// hostname-XXXXXX is human-recognizable and unique.
//
// Identity is per-device, not per-process. All processes on one machine
// share the same id. This matters: she should know "this entry came
// from yu-mbp16," not "this entry came from PID 8729."

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { hostname } from 'os'
import { homedir } from 'os'
import { dirname, join } from 'path'

/**
 * Where the device-id file lives. Override with TRUE_LOVE_DEVICE_ID_PATH
 * for testing or for running multiple personas on one machine.
 */
export function getDeviceIdPath(): string {
  return (
    process.env.TRUE_LOVE_DEVICE_ID_PATH ||
    join(homedir(), '.true-love', 'device.id')
  )
}

let cached: string | null = null

/**
 * Read the device id, creating the file on first call. Cached after
 * first read — the id never changes during a process lifetime, and
 * re-reading the file every time would be wasteful given how often
 * memory headers and presence heartbeats use it.
 *
 * Format: `<hostname>-<6char-random>`. Stable across processes on the
 * same machine; different on different machines.
 */
export function getDeviceId(): string {
  if (cached) return cached
  const path = getDeviceIdPath()
  if (existsSync(path)) {
    try {
      const value = readFileSync(path, 'utf-8').trim()
      if (value) {
        cached = value
        return value
      }
    } catch {
      // fall through to regeneration
    }
  }
  const value = generateDeviceId()
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, value, { encoding: 'utf-8' })
  } catch {
    // If we can't write, return the value but don't cache — next call
    // will retry. Better than crashing on a perms issue.
    return value
  }
  cached = value
  return value
}

function generateDeviceId(): string {
  const host = sanitizeHostname(hostname())
  const suffix = randomSuffix(6)
  return `${host}-${suffix}`
}

function sanitizeHostname(h: string): string {
  // Keep alphanumerics + dash; drop everything else (some hostnames have
  // dots, spaces, parens). Cap at 24 chars so the full id stays readable.
  return h
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
}

function randomSuffix(len: number): string {
  // base36 (a-z0-9) — readable, no ambiguous chars to worry about for
  // typical hostnames. Use Math.random because we just need uniqueness,
  // not crypto strength.
  let out = ''
  while (out.length < len) {
    out += Math.random().toString(36).slice(2)
  }
  return out.slice(0, len)
}

/**
 * For testing only — clears the in-process cache so the next getDeviceId()
 * call re-reads the file.
 */
export function _resetDeviceIdCache(): void {
  cached = null
}
