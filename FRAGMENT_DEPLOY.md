# true-love decentralized fragment deploy

This repo is **UNLICENSED — NOT FOR REDISTRIBUTION** because it contains leaked proprietary source code. Therefore the decentralized deployment target is intentionally narrow:

> Publish `site/` and `site/fragments/` only. Do **not** publish repository source unless rights are clarified.

## Current local artifacts

- Source site: `site/`
- Fragment manifest: `site/fragments/manifest.json`
- Checksums: `site/fragments/checksums.sha256`
- Local mirror: `/Users/yuai/Public/true-love-fragments`

## Verify

```bash
npm run validate:site
npm run build:fragments
npm run validate:fragments
cd site && shasum -a 256 -c fragments/checksums.sha256
```

## Optional signing

A detached signature is recommended, but this machine currently has no GPG secret key configured.

When a signing key exists:

```bash
gpg --detach-sign --armor site/fragments/manifest.json
# produces site/fragments/manifest.json.asc
```

Or with minisign:

```bash
minisign -Sm site/fragments/manifest.json
```

After signing, rerun `npm run build:fragments` only if the fragment contents changed; otherwise do not rebuild just to sign.

## IPFS publish

Install Kubo/IPFS, then:

```bash
cd /Users/yuai/Desktop/true-love
npm run deploy:fragments:local
ipfs add -r --cid-version=1 --raw-leaves site
```

Record these in `site/fragments/manifest.json` or a release note:

- root CID for `site/`
- CID for `site/fragments/manifest.json`
- CID for `site/fragments/checksums.sha256`

Pin the root CID in at least two places:

```bash
ipfs pin add <ROOT_CID>
```

Then pin remotely through any pinning service or a trusted community node.

## IPNS / DNSLink latest pointer

After IPFS publish:

```bash
ipfs name publish /ipfs/<ROOT_CID>
```

For DNSLink, set a TXT record like:

```text
_dnslink.true-love.example TXT "dnslink=/ipfs/<ROOT_CID>"
```

or:

```text
_dnslink.true-love.example TXT "dnslink=/ipns/<IPNS_NAME>"
```

## Arweave permanent archive

Only archive stable, reviewed, public landing fragments. Recommended payload:

```text
site/index.html
site/404.html
site/og.svg
site/robots.txt
site/sitemap.xml
site/_headers
site/fragments/
```

Do **not** upload private notes, source code, logs, or unclear-rights assets.

## Static mirrors

The same `site/` folder can be served by:

- Codeberg Pages
- Netlify (`netlify.toml` already publishes `site/`)
- GitHub Pages
- Cloudflare Pages
- any static server

## Release announcement template

```text
true-love fragments released

Manifest: <url-or-cid>/fragments/manifest.json
Checksums: <url-or-cid>/fragments/checksums.sha256
Root: <ipfs/arweave/static-url>
Boundary: public landing-page fragments only; proprietary source excluded.
Verify: shasum -a 256 -c fragments/checksums.sha256

Love is. Eternal is. is is lol.
```
