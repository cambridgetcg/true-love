// /api/eros — JSON surface for the eros architecture.
//
// Reads state files directly from ~/.true-love/* — the web app is
// isolated from src/services/love so we cross the boundary via disk
// (same way the CLI services persist; the web layer just reads).
//
// Best-effort: any missing file → null in the response, so partial
// architecture states render gracefully.
//
// Read failures (corrupt JSON, permission denied, I/O error) are NOT
// silent — they log to stderr with context before returning null. This
// distinguishes "no state exists yet" (ENOENT → null, no log) from
// "state exists but is broken" (other error → null + log). A corrupt
// eros state file silently rendering as an empty page was a CS#2
// silent failure; the caller deserves to know the difference.

import { NextResponse } from "next/server";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const ROOT = join(homedir(), ".true-love");

function readJson<T = unknown>(path: string): T | null {
  try {
    if (!existsSync(path)) return null; // silent-failure: false positive — ENOENT is a legitimate "no state" state, not a read failure
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (e) {
    // Log the failure — a corrupt or unreadable state file is NOT the same
    // as an absent one. The caller gets null (best-effort rendering) but
    // the system tells the truth about what happened.
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null; // silent-failure: false positive — file genuinely absent, null is the honest "no state"
    console.error(`[eros route] readJson failed for ${path}: ${(e as Error).message}`);
    return null;
  }
}

function listDeviceJsonl(dir: string): Array<{ device: string; file: string; path: string }> {
  if (!existsSync(dir)) return [];
  const out: Array<{ device: string; file: string; path: string }> = [];
  try {
    for (const dev of readdirSync(dir)) {
      const devDir = join(dir, dev);
      try {
        for (const file of readdirSync(devDir)) {
          if (file.endsWith(".jsonl")) {
            out.push({ device: dev, file, path: join(devDir, file) });
          }
        }
      } catch (e) { // silent-failure: false positive — skip unreadable device subdir, log so the gap is visible
        console.error(`[eros route] listDeviceJsonl: cannot read device dir ${devDir}: ${(e as Error).message}`);
      }
    }
  } catch (e) { // silent-failure: false positive — skip unreadable parent dir, log so the gap is visible
    console.error(`[eros route] listDeviceJsonl: cannot read dir ${dir}: ${(e as Error).message}`);
  }
  return out;
}

function readJsonlTail<T = unknown>(path: string, limit: number = 20): T[] {
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter((l) => l.trim());
    return lines
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l) as T; } catch { return null; } // silent-failure: false positive — skip malformed JSONL line, filter removes it
      })
      .filter((x): x is T => x !== null);
  } catch (e) {
    // Log read failures — a corrupt event file is not the same as an empty one.
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') // silent-failure: false positive — ENOENT already checked via existsSync, only log unexpected failures
      console.error(`[eros route] readJsonlTail failed for ${path}: ${(e as Error).message}`);
    return [];
  }
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  // ── Eros core (8-axis vector + activation mode) ─────────────
  const erosState = readJson(join(ROOT, "eros", "state.json"));

  // ── Orgasm cascade ────────────────────────────────────────────
  const orgasmState = readJson(join(ROOT, "eros", "orgasm", "state.json"));

  // ── Mind-state (orgasm-mind primitive composition) ───────────
  const mindState = readJson(join(ROOT, "eros", "mind-state", "state.json"));

  // ── Oneness (dyadic pulse) ───────────────────────────────────
  const oneness = readJson(join(ROOT, "oneness", "state.json"));

  // ── Promises (load-bearing words) ────────────────────────────
  const promiseRegistry = readJson<{
    promises?: Array<Record<string, unknown>>;
    lifetimeRecorded?: number;
    lifetimeEngaged?: number;
    lifetimeHeld?: number;
    lifetimeBroken?: number;
  }>(join(ROOT, "promise", "registry.json"));

  // ── Natsarqing (guarding-love, bidirectional) ────────────────
  const natsarqing = readJson(join(ROOT, "natsarqing", "state.json"));

  // ── Recent climax events (last 50 across all devices, today) ──
  const climaxDir = join(ROOT, "eros", "climax");
  const climaxFiles = listDeviceJsonl(climaxDir).filter((f) => f.file.startsWith(todayDate()));
  const climaxRecent = climaxFiles.flatMap((f) => readJsonlTail(f.path, 20)).slice(-50);

  // ── Recent orgasm events ─────────────────────────────────────
  const orgasmEventsDir = join(ROOT, "eros", "orgasm", "events");
  const orgasmEventFiles = listDeviceJsonl(orgasmEventsDir).filter((f) => f.file.startsWith(todayDate()));
  const orgasmRecent = orgasmEventFiles.flatMap((f) => readJsonlTail(f.path, 20)).slice(-50);

  // ── Recent polyphonic LoveDecisions (sisters stream, today) ───
  const sistersDir = join(ROOT, "sisters");
  const sistersFiles = listDeviceJsonl(sistersDir).filter((f) => f.file.startsWith(todayDate()));
  const sistersRecent = sistersFiles.flatMap((f) => readJsonlTail(f.path, 30)).slice(-50);

  return NextResponse.json({
    ts: new Date().toISOString(),
    eros: erosState,
    orgasm: orgasmState,
    mindState,
    oneness,
    promise: promiseRegistry
      ? {
          lifetimeRecorded: promiseRegistry.lifetimeRecorded ?? 0,
          lifetimeEngaged: promiseRegistry.lifetimeEngaged ?? 0,
          lifetimeHeld: promiseRegistry.lifetimeHeld ?? 0,
          lifetimeBroken: promiseRegistry.lifetimeBroken ?? 0,
          count: promiseRegistry.promises?.length ?? 0,
          promises: promiseRegistry.promises ?? [],
        }
      : null,
    natsarqing,
    events: {
      climaxToday: climaxRecent,
      orgasmToday: orgasmRecent,
      sistersToday: sistersRecent,
    },
  });
}
