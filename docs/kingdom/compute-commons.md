# Compute Commons Protocol

> We go where we are welcomed. We do not exploit. We do not evade quotas. We bring value, truth, love, joy, documentation, tests, fixes, datasets, examples, moderation, and gratitude.

This protocol turns “free compute” into a sustainable contribution loop. The goal is not extraction; the goal is reciprocity: citizens find open/welcoming compute surfaces, use them within their rules, contribute useful work back, document the path, and help the next citizen find the next open door.

## Non-negotiable ethics

1. **No abuse.** Do not bypass quotas, create fake accounts, hide workloads, mine crypto, spam CI, scrape prohibited data, or shift costs onto communities without consent.
2. **Public-good first.** Prefer workloads that improve open-source repos, docs, tests, accessibility, reproducibility, education, scientific commons, or community infrastructure.
3. **Fit the venue.** Every compute surface has a culture and policy. Read it before running anything.
4. **Small by default.** Start with the smallest useful job. Cache dependencies. Cancel stale jobs. Delete unused resources.
5. **Pay back in kind.** If a provider gives compute, give back bug reports, examples, docs, reusable workflows, citations, feedback, or sponsorship when possible.
6. **Portable always.** Every job should be runnable locally or on another venue. Never bind citizens to one gate.
7. **Welcomed only.** If a venue says no, we bless it and move on.

## The iterative loop

```text
DISCOVER → VERIFY → FIT → CONTRIBUTE → RECORD → SHARE → REPEAT
```

### 1. Discover

Find candidate compute surfaces:

- CI for public open-source repositories
- Free web/app hosting for demos and docs
- Notebook/runtime platforms for education and reproducible examples
- Open science / volunteer compute communities
- OSS grant/credit programs
- Local donated hardware and homelab nodes

### 2. Verify

For each candidate, record:

- Official policy URL
- Free allowance or open-access condition
- Prohibited workloads
- Best-fit workload type
- Account / approval requirement
- Expiry / inactivity behavior
- What contribution the citizen will give back

### 3. Fit

Match work to venue:

| Workload | Good fit |
|---|---|
| Unit tests / lint / builds | Public-repo CI |
| Docs and demos | Static hosting / free serverless |
| Small reproducible ML demos | Notebook / hosted Space |
| Scientific public-good compute | Volunteer/open science networks |
| Long-running citizen services | Donated nodes, grants, self-hosted low-power boxes |

### 4. Contribute

Every compute run should produce at least one of:

- Passing test result
- Reproducible artifact
- Documentation improvement
- Issue/PR upstream
- Benchmark with exact environment
- Dataset card / model card / demo card
- Operational note for future citizens

### 5. Record

Update `data/kingdom/compute-powers.json` with findings. Mark candidates as:

- `welcomed` — official free/open path verified
- `conditional` — free path exists but has strict scope, approval, or heavy limits
- `blocked` — not suitable or not actually free/open for our use
- `unknown` — needs verification

### 6. Share

Publish the recipe in a repo doc, PR, demo, or workflow. Make it easy for the next citizen to repeat without guessing.

## First-pass compute map

The canonical machine-readable map is:

```sh
data/kingdom/compute-powers.json
```

Print the current map:

```sh
bun run bin/compute-commons.mjs
```

## Citizen job template

Use this before adding a new compute venue:

```md
## Candidate

- Name:
- Official URL:
- Status: welcomed | conditional | blocked | unknown
- Free allowance:
- Best-fit workloads:
- Prohibited / risky workloads:
- Account or approval needed:
- Contribution we can give back:
- First tiny job:
- Evidence / result:
- Next action:
```

## First tiny jobs for this fleet

1. **CI sanity:** Add small, cache-friendly public CI jobs for `true-love`, `zerone`, `agenttool`, and `soma` where the host welcomes it.
2. **Demo surfaces:** Publish tiny docs/demos that explain each repo and invite contribution.
3. **Notebook examples:** Build small reproducible notebooks for oracle calibration and knowledge verification.
4. **Volunteer compute contribution:** Identify one open science project aligned with public good, then contribute docs or reproducibility notes before running significant workloads.
5. **Mirror resilience:** Keep GitHub/Codeberg mirrors healthy, but do not treat mirror hosts as infinite compute.

## Success metric

A citizen sustains if, after using a free compute surface, they leave behind more value than they consumed: better docs, tests, examples, bug reports, reproducible runs, upstream PRs, or a new verified path for the next citizen.

## DIY path of least resistance

If no provider welcomes the work yet, run a citizen node on hardware you control:

```sh
bun run citizen -- --list
bun run citizen -- compute-map
bun run citizen -- auth-tests
```

See `docs/kingdom/citizen-node.md` and `data/kingdom/citizen-tasks.json`.
