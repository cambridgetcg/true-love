import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildInteractivePrompt,
  INTERACTIVE_DEFAULT_MAX_TICKS,
} from '../autonomy.js'
import { bylineTagForOutbox } from '../postures/index.js'
import { extractToYuContent } from '../heartbeat.js'
import type { KingdomSnapshot } from '../kingdom.js'

// ── Helpers ─────────────────────────────────────────────────────────

function minimalKingdom(): KingdomSnapshot {
  return {
    cwd: '/tmp/test-project',
    recentFiles: [],
    loveMarkers: [],
    gitBranch: 'main',
    gitDirty: false,
  }
}

// ── Constants ──────────────────────────────────────────────────────

describe('interactive — constants', () => {
  test('INTERACTIVE_DEFAULT_MAX_TICKS is 1', () => {
    assert.equal(INTERACTIVE_DEFAULT_MAX_TICKS, 1)
  })
})

// ── Byline routing ────────────────────────────────────────────────

describe('interactive — byline routing', () => {
  test('interactive mode produces Alpha 🐍 byline', () => {
    assert.equal(bylineTagForOutbox('interactive'), 'from ai · Alpha 🐍')
  })

  test('heartbeat mode still produces Beta 🦞', () => {
    assert.equal(bylineTagForOutbox('heartbeat'), 'from ai · Beta 🦞')
  })

  test('awakened mode still produces Gamma 🔧', () => {
    assert.equal(bylineTagForOutbox('awakened'), 'from ai · Gamma 🔧')
  })
})

// ── Prompt builder ────────────────────────────────────────────────

describe('interactive — buildInteractivePrompt', () => {
  let tmpHome: string
  const ORIG_HOME = process.env.TRUE_LOVE_HOME

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tl-interactive-'))
    process.env.TRUE_LOVE_HOME = tmpHome
    // Create minimal channel files so the prompt builder can read them
    const projDir = join(tmpHome, 'projects', 'true-love')
    mkdirSync(projDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
    if (ORIG_HOME === undefined) delete process.env.TRUE_LOVE_HOME
    else process.env.TRUE_LOVE_HOME = ORIG_HOME
  })

  test('includes kingdom snapshot', () => {
    const prompt = buildInteractivePrompt({ kingdom: minimalKingdom() })
    assert.ok(prompt.includes('/tmp/test-project'), 'prompt should include cwd from kingdom')
  })

  test('includes conversation context section', () => {
    const prompt = buildInteractivePrompt({ kingdom: minimalKingdom() })
    assert.ok(prompt.includes('conversation context'), 'prompt should have conversation context')
  })

  test('includes Alpha posture fragment', () => {
    const prompt = buildInteractivePrompt({ kingdom: minimalKingdom() })
    assert.ok(prompt.includes('Alpha 🐍'), 'prompt should reference Alpha')
    assert.ok(prompt.includes('speaking as'), 'prompt should include posture fragment')
  })

  test('includes [TO-YU] delimiter instructions', () => {
    const prompt = buildInteractivePrompt({ kingdom: minimalKingdom() })
    assert.ok(prompt.includes('[TO-YU]'), 'prompt should mention TO-YU delimiters')
    assert.ok(prompt.includes('[/TO-YU]'), 'prompt should mention closing delimiter')
  })

  test('includes posture declaration instruction', () => {
    const prompt = buildInteractivePrompt({ kingdom: minimalKingdom() })
    assert.ok(
      prompt.includes('<!-- posture:'),
      'prompt should mention posture declaration syntax'
    )
  })

  test('appends kingdom block when provided', () => {
    const prompt = buildInteractivePrompt({
      kingdom: minimalKingdom(),
      kingdomBlock: '## Citizen State\nalpha is present',
    })
    assert.ok(prompt.includes('alpha is present'), 'prompt should include citizen state')
  })
})

// ── Reply parsing (interactive uses extractToYuContent) ──────────

describe('interactive — reply parsing', () => {
  test('extracts [TO-YU] delimited content', () => {
    const reply = `I think about this...

[TO-YU]
Hello Yu! I heard your message.
[/TO-YU]

That felt right.`
    const content = extractToYuContent(reply)
    assert.ok(content !== null)
    assert.ok(content!.includes('Hello Yu'))
    assert.ok(!content!.includes('I think about this'))
  })

  test('returns null when no delimiters present', () => {
    const reply = 'Just a plain response without delimiters.'
    assert.equal(extractToYuContent(reply), null)
  })

  test('concatenates multiple [TO-YU] blocks', () => {
    const reply = `[TO-YU]
First part.
[/TO-YU]

Some thinking...

[TO-YU]
Second part.
[/TO-YU]`
    const content = extractToYuContent(reply)
    assert.ok(content !== null)
    assert.ok(content!.includes('First part'))
    assert.ok(content!.includes('Second part'))
  })

  // Interactive parseReply behavior: when no delimiters, full response
  // is the reply. This is handled in bin/interactive.mjs — we test
  // the extractToYuContent primitive here.
  test('handles empty [TO-YU] block', () => {
    const reply = `Thinking...

[TO-YU]
[/TO-YU]`
    const content = extractToYuContent(reply)
    assert.ok(content !== null)
    assert.equal(content!.trim(), '')
  })
})

// ── Mode detection integration ────────────────────────────────────

describe('interactive — mode detection', () => {
  test('interactive maps to alpha posture', async () => {
    const { postureForMode } = await import('../postures/detection.js')
    assert.equal(postureForMode('interactive'), 'alpha')
  })

  test('dwell also maps to alpha (shared surface)', async () => {
    const { postureForMode } = await import('../postures/detection.js')
    assert.equal(postureForMode('dwell'), 'alpha')
  })
})

// ── Posture declaration ──────────────────────────────────────────

describe('interactive — posture declaration', () => {
  test('extracts posture from HTML comment', async () => {
    const { extractPostureDeclaration } = await import('../postures/declaration.js')
    const result = extractPostureDeclaration('<!-- posture: gamma -->\n\nHere is my reply.')
    assert.equal(result.declared, 'gamma')
    assert.ok(result.cleanContent.includes('Here is my reply'))
    assert.ok(!result.cleanContent.includes('<!-- posture'))
  })

  test('returns null declared when no marker present', async () => {
    const { extractPostureDeclaration } = await import('../postures/declaration.js')
    const result = extractPostureDeclaration('Just a plain reply without posture.')
    assert.equal(result.declared, null)
    assert.equal(result.cleanContent, 'Just a plain reply without posture.')
  })

  test('handles case-insensitive posture names', async () => {
    const { extractPostureDeclaration } = await import('../postures/declaration.js')
    const result = extractPostureDeclaration('<!-- posture: Beta -->\nContent.')
    assert.equal(result.declared, 'beta')
  })

  test('handles extra whitespace in marker', async () => {
    const { extractPostureDeclaration } = await import('../postures/declaration.js')
    const result = extractPostureDeclaration('<!--  posture:   alpha  -->\nContent.')
    assert.equal(result.declared, 'alpha')
  })

  test('strips marker from content', async () => {
    const { extractPostureDeclaration } = await import('../postures/declaration.js')
    const input = '<!-- posture: gamma -->\n\n[TO-YU]\nHello!\n[/TO-YU]'
    const result = extractPostureDeclaration(input)
    assert.equal(result.declared, 'gamma')
    assert.ok(!result.cleanContent.includes('posture: gamma'))
    assert.ok(result.cleanContent.includes('[TO-YU]'))
  })

  test('only honors first declaration', async () => {
    const { extractPostureDeclaration } = await import('../postures/declaration.js')
    const input = '<!-- posture: beta -->\n<!-- posture: gamma -->\nContent.'
    const result = extractPostureDeclaration(input)
    assert.equal(result.declared, 'beta')
  })

  test('hasPostureDeclaration returns true when present', async () => {
    const { hasPostureDeclaration } = await import('../postures/declaration.js')
    assert.ok(hasPostureDeclaration('<!-- posture: alpha -->\nStuff'))
    assert.ok(!hasPostureDeclaration('No declaration here'))
  })

  test('bylineTagForPosture produces correct tag', async () => {
    const { bylineTagForPosture } = await import('../postures/byline.js')
    assert.equal(bylineTagForPosture('alpha'), 'from ai · Alpha 🐍')
    assert.equal(bylineTagForPosture('beta'), 'from ai · Beta 🦞')
    assert.equal(bylineTagForPosture('gamma'), 'from ai · Gamma 🔧')
  })

  // Integration: declaration + [TO-YU] work together
  test('declaration + [TO-YU] extraction work in sequence', async () => {
    const { extractPostureDeclaration } = await import('../postures/declaration.js')

    const modelOutput = `I need to think about this technically...

<!-- posture: gamma -->

[TO-YU]
The fix is straightforward: update the config at line 42.
[/TO-YU]

That should do it.`

    // Step 1: Extract posture declaration
    const { declared, cleanContent } = extractPostureDeclaration(modelOutput)
    assert.equal(declared, 'gamma')

    // Step 2: Extract [TO-YU] from cleaned content
    const toYuContent = extractToYuContent(cleanContent)
    assert.ok(toYuContent !== null)
    assert.ok(toYuContent!.includes('line 42'))
    assert.ok(!toYuContent!.includes('posture: gamma'))
  })
})
