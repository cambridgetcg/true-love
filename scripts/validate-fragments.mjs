import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repo = process.cwd();
const site = path.join(repo, 'site');
const fragments = path.join(site, 'fragments');
const required = ['manifest.json', 'checksums.sha256', 'README.md', 'LICENSE.md', 'hero.html', 'wake.md', 'love.md', 'youspeak.md', 'kingdom.json', 'links.json', 'deploy.json'];
let ok = true;
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

for (const rel of required) {
  if (!fs.existsSync(path.join(fragments, rel))) {
    console.error(`missing site/fragments/${rel}`); ok = false;
  }
}

const manifestPath = path.join(fragments, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { fragments: [] };
if (manifest.boundary !== 'Public landing-page fragments only; proprietary source code is excluded.') {
  console.error('manifest boundary is missing or changed'); ok = false;
}
if (!Array.isArray(manifest.fragments) || manifest.fragments.length < 8) {
  console.error('manifest needs at least 8 fragments'); ok = false;
}
for (const entry of manifest.fragments ?? []) {
  for (const key of ['id', 'path', 'type', 'bytes', 'sha256']) {
    if (!entry[key]) { console.error(`manifest entry missing ${key}`); ok = false; }
  }
  const file = path.join(site, entry.path ?? '');
  if (!fs.existsSync(file)) { console.error(`manifest path missing: ${entry.path}`); ok = false; continue; }
  const actualHash = sha256(file);
  const actualBytes = fs.statSync(file).size;
  if (actualHash !== entry.sha256) { console.error(`hash mismatch: ${entry.path}`); ok = false; }
  if (actualBytes !== entry.bytes) { console.error(`byte mismatch: ${entry.path}`); ok = false; }
}

const checksumPath = path.join(fragments, 'checksums.sha256');
if (fs.existsSync(checksumPath)) {
  for (const line of fs.readFileSync(checksumPath, 'utf8').trim().split('\n')) {
    const match = line.match(/^([a-f0-9]{64})\s{2}(.+)$/);
    if (!match) { console.error(`bad checksum line: ${line}`); ok = false; continue; }
    const [, expected, rel] = match;
    const file = path.join(site, rel);
    if (!fs.existsSync(file)) { console.error(`checksum target missing: ${rel}`); ok = false; continue; }
    const actual = sha256(file);
    if (actual !== expected) { console.error(`checksum mismatch: ${rel}`); ok = false; }
  }
}

const licenseText = fs.existsSync(path.join(fragments, 'LICENSE.md')) ? fs.readFileSync(path.join(fragments, 'LICENSE.md'), 'utf8') : '';
if (!licenseText.includes('does **not** include or authorize redistribution of proprietary source code')) {
  console.error('fragment license boundary missing'); ok = false;
}

if (!ok) process.exit(1);
console.log(`fragment validation OK (${manifest.fragments?.length ?? 0} fragments)`);
