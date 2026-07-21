#!/usr/bin/env bun
/** Compose a piece into the house library.
 *
 *  Usage:
 *    bun music/engine/compose.ts [--style classical|jazz|lofi|ambient]
 *                                [--mood settled|tender|fire|wander|bright]
 *                                [--seed <str>] [--bars <n>] [--title <str>]
 *
 *  Writes music/pieces/<slug>.json + .abc, appends to playlists/house.json,
 *  rebuilds player/dist.html. Deterministic per seed. The house heartbeat
 *  (../agenttool/bin/.heartbeat-state.json, fail-silent) nudges tempo ±4.
 */

import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

import { generateScore, scoreToABC, validateScore } from "./engine.js";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const seed = flag("seed") ?? `${new Date().toISOString().slice(0, 16)}·${Math.floor(Math.random() * 1e6)}`;

// The house heartbeat nudges the tempo, gently. Fail-silent by design.
let tempoNudge = 0;
try {
  const hb = await Bun.file(
    join(process.env.HOME ?? "", "Desktop/agenttool/bin/.heartbeat-state.json"),
  ).json();
  if (typeof hb?.bpm === "number") tempoNudge = Math.max(-4, Math.min(4, Math.round((hb.bpm - 72) / 8)));
} catch {
  /* no heartbeat on this machine — the music stands alone */
}

const score = generateScore(seed, {
  style: flag("style"),
  mood: flag("mood"),
  bars: flag("bars") ? Number(flag("bars")) : undefined,
  title: flag("title"),
  tempoNudge,
});

const errs = validateScore(score);
if (errs.length) {
  console.error(`ERROR invalid score: ${errs.slice(0, 3).join("; ")}`);
  process.exit(1);
}

const musicDir = join(dirname(dirname(Bun.main)), "");
const slug = score.title
  .toLowerCase()
  .replace(/\(.*\)/g, "")
  .trim()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");
const piecePath = join(musicDir, "pieces", `${slug}.json`);
const abcPath = join(musicDir, "pieces", `${slug}.abc`);

await mkdir(join(musicDir, "pieces"), { recursive: true });
await Bun.write(piecePath, JSON.stringify(score, null, 2) + "\n");
await Bun.write(abcPath, scoreToABC(score));

// Append to the house playlist (create if missing).
const playlistPath = join(musicDir, "playlists", "house.json");
let playlist: { name: string; pieces: Array<{ file: string; title: string; style: string; mood?: string }> };
try {
  playlist = await Bun.file(playlistPath).json();
} catch {
  playlist = { name: "the house playlist", pieces: [] };
}
if (!playlist.pieces.some((p) => p.file === `${slug}.json`)) {
  playlist.pieces.push({
    file: `${slug}.json`,
    title: score.title,
    style: score.style,
    ...(flag("mood") ? { mood: flag("mood") } : {}),
  });
}
await mkdir(join(musicDir, "playlists"), { recursive: true });
await Bun.write(playlistPath, JSON.stringify(playlist, null, 2) + "\n");

// Rebuild the 音響 so the new piece is instantly playable.
const build = Bun.spawnSync(["bun", join(musicDir, "engine", "build-player.ts")]);
const rebuilt = build.exitCode === 0 ? " · player rebuilt" : " · PLAYER REBUILD FAILED";

console.log(
  `OK composed "${score.title}" · ${score.style} · ${score.key} ${score.mode} · ${score.bpm}bpm · ${score.bars} bars · seed=${score.seed}${rebuilt}`,
);
console.log(`   ${piecePath}`);
