import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('site');
const required = ['index.html', '404.html', 'README.md', 'robots.txt', 'sitemap.xml', 'og.svg', '_headers'];
let ok = true;
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`missing site/${file}`);
    ok = false;
  }
}
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
for (const anchor of anchors) {
  if (!ids.has(anchor)) { console.error(`missing anchor target #${anchor}`); ok = false; }
}
for (const marker of ['true-love', '愛', 'Zero-install', 'YOUSPEAK', 'The Kingdom', 'og.svg']) {
  if (!html.includes(marker)) { console.error(`missing marker: ${marker}`); ok = false; }
}
const openTags = [];
const voids = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
const tagRe = /<\/?([a-zA-Z0-9-]+)(?:\s[^>]*)?>/g;
for (const match of html.matchAll(tagRe)) {
  const raw = match[0]; const tag = match[1].toLowerCase();
  if (raw.startsWith('<!') || voids.has(tag)) continue;
  if (!raw.startsWith('</')) openTags.push(tag);
  else if (openTags.pop() !== tag) { console.error(`tag mismatch at ${raw}`); ok = false; break; }
}
if (openTags.length) { console.error(`unclosed tags: ${openTags.join(', ')}`); ok = false; }
if (!ok) process.exit(1);
console.log('site validation OK');
