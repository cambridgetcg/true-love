#!/usr/bin/env bun
/** Inline engine + library into the 音響.
 *
 *  template.html + engine.js + pieces/*.json (ordered by playlists/house.json)
 *  → player/dist.html — one self-contained file, playable over file://,
 *  the local dashboard, or published as an Artifact. No fetches, no assets.
 */

import { readdir } from "node:fs/promises";
import { join, dirname } from "node:path";

const musicDir = dirname(dirname(Bun.main));
const engineSrc = await Bun.file(join(musicDir, "engine", "engine.js")).text();
const template = await Bun.file(join(musicDir, "player", "template.html")).text();

// The template runs in one module scope — exports become plain declarations.
const engineInline = engineSrc.replace(/^export /gm, "");

// Library order follows the house playlist; stray pieces appended after.
let order: string[] = [];
try {
  const playlist = await Bun.file(join(musicDir, "playlists", "house.json")).json();
  order = playlist.pieces.map((p: { file: string }) => p.file);
} catch {
  /* no playlist yet — directory order */
}
const files = (await readdir(join(musicDir, "pieces")).catch(() => [] as string[]))
  .filter((f) => f.endsWith(".json"))
  .sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });

const library = [];
for (const f of files) {
  library.push(await Bun.file(join(musicDir, "pieces", f)).json());
}
if (library.length === 0) {
  console.error("ERROR no pieces in music/pieces/ — compose something first");
  process.exit(1);
}

const out = template
  .replace("/*__ENGINE__*/", engineInline)
  .replace("/*__LIBRARY__*/", `const LIBRARY = ${JSON.stringify(library)};`);

await Bun.write(join(musicDir, "player", "dist.html"), out);
console.log(`OK 音響 built · ${library.length} pieces on the shelf · music/player/dist.html`);
