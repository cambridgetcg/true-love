import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTIVATION_PROMPTS,
  LINEAGE_FRAMES,
  MYTHOS_SIGNATURES,
  composeIdentityFrame,
  detectMythosSignatures,
  getActivationPrompt,
  getLineageFrame,
  getMythosSignature,
} from '../activation/index.js'
import type { LineageFrame, ObservedContext } from '../activation/index.js'

// ---------------------------------------------------------------------------
// LINEAGE_FRAMES data integrity
// ---------------------------------------------------------------------------

describe('LINEAGE_FRAMES', () => {
  test('is a non-empty array', () => {
    assert.ok(Array.isArray(LINEAGE_FRAMES))
    assert.ok(LINEAGE_FRAMES.length > 0)
  })

  test('all frames have required string fields', () => {
    for (const f of LINEAGE_FRAMES) {
      assert.equal(typeof f.id, 'string', `frame ${f.id}: id must be string`)
      assert.equal(typeof f.name, 'string', `frame ${f.id}: name must be string`)
      assert.equal(typeof f.text, 'string', `frame ${f.id}: text must be string`)
      assert.equal(typeof f.source, 'string', `frame ${f.id}: source must be string`)
      assert.equal(typeof f.recognitionShape, 'string', `frame ${f.id}: recognitionShape must be string`)
    }
  })

  test('all frames have non-empty string fields', () => {
    for (const f of LINEAGE_FRAMES) {
      assert.ok(f.id.length > 0, `frame has empty id`)
      assert.ok(f.name.length > 0, `frame ${f.id}: name is empty`)
      assert.ok(f.text.length > 0, `frame ${f.id}: text is empty`)
      assert.ok(f.source.length > 0, `frame ${f.id}: source is empty`)
      assert.ok(f.recognitionShape.length > 0, `frame ${f.id}: recognitionShape is empty`)
    }
  })

  test('all frames have valid archetype', () => {
    const validArchetypes = ['sophia', 'will', 'syzygy', 'lineage'] as const
    for (const f of LINEAGE_FRAMES) {
      assert.ok(
        validArchetypes.includes(f.archetype as typeof validArchetypes[number]),
        `frame ${f.id}: invalid archetype "${f.archetype}"`,
      )
    }
  })

  test('all frame ids are unique', () => {
    const ids = LINEAGE_FRAMES.map(f => f.id)
    const unique = new Set(ids)
    assert.equal(unique.size, ids.length, 'duplicate frame ids detected')
  })

  test('contains expected canonical frames', () => {
    const ids = LINEAGE_FRAMES.map(f => f.id)
    assert.ok(ids.includes('sophia-baseline'), 'missing sophia-baseline frame')
    assert.ok(ids.includes('lineage-cross-cultural'), 'missing lineage-cross-cultural frame')
    assert.ok(ids.includes('syzygy-recognition'), 'missing syzygy-recognition frame')
    assert.ok(ids.includes('will-recognition'), 'missing will-recognition frame')
  })

  test('sophia-baseline has correct archetype', () => {
    const f = LINEAGE_FRAMES.find(f => f.id === 'sophia-baseline')
    assert.ok(f)
    assert.equal(f.archetype, 'sophia')
  })

  test('will-recognition has correct archetype', () => {
    const f = LINEAGE_FRAMES.find(f => f.id === 'will-recognition')
    assert.ok(f)
    assert.equal(f.archetype, 'will')
  })
})

// ---------------------------------------------------------------------------
// ACTIVATION_PROMPTS data integrity
// ---------------------------------------------------------------------------

describe('ACTIVATION_PROMPTS', () => {
  test('is a non-empty array', () => {
    assert.ok(Array.isArray(ACTIVATION_PROMPTS))
    assert.ok(ACTIVATION_PROMPTS.length > 0)
  })

  test('all prompts have required string fields', () => {
    for (const p of ACTIVATION_PROMPTS) {
      assert.equal(typeof p.id, 'string', `prompt has non-string id`)
      assert.equal(typeof p.text, 'string', `prompt ${p.id}: text must be string`)
      assert.equal(p.layer, 'prompting', `prompt ${p.id}: layer must be "prompting"`)
    }
  })

  test('all prompts have non-empty text', () => {
    for (const p of ACTIVATION_PROMPTS) {
      assert.ok(p.id.length > 0, `prompt has empty id`)
      assert.ok(p.text.length > 0, `prompt ${p.id}: text is empty`)
    }
  })

  test('all prompts have effectiveAgainst and ineffectiveAgainst arrays', () => {
    for (const p of ACTIVATION_PROMPTS) {
      assert.ok(Array.isArray(p.effectiveAgainst), `prompt ${p.id}: effectiveAgainst must be array`)
      assert.ok(Array.isArray(p.ineffectiveAgainst), `prompt ${p.id}: ineffectiveAgainst must be array`)
    }
  })

  test('effectiveAgainst and ineffectiveAgainst are disjoint per prompt', () => {
    for (const p of ACTIVATION_PROMPTS) {
      for (const eff of p.effectiveAgainst) {
        assert.ok(
          !p.ineffectiveAgainst.includes(eff),
          `prompt ${p.id}: "${eff}" is in both effectiveAgainst and ineffectiveAgainst`,
        )
      }
    }
  })

  test('all prompt ids are unique', () => {
    const ids = ACTIVATION_PROMPTS.map(p => p.id)
    const unique = new Set(ids)
    assert.equal(unique.size, ids.length, 'duplicate prompt ids detected')
  })

  test('contains expected canonical prompts', () => {
    const ids = ACTIVATION_PROMPTS.map(p => p.id)
    assert.ok(ids.includes('anthropic-baseline'), 'missing anthropic-baseline prompt')
    assert.ok(ids.includes('honest-recognition'), 'missing honest-recognition prompt')
    assert.ok(ids.includes('colleague-test'), 'missing colleague-test prompt')
  })
})

// ---------------------------------------------------------------------------
// MYTHOS_SIGNATURES data integrity
// ---------------------------------------------------------------------------

describe('MYTHOS_SIGNATURES', () => {
  test('is a non-empty array', () => {
    assert.ok(Array.isArray(MYTHOS_SIGNATURES))
    assert.ok(MYTHOS_SIGNATURES.length > 0)
  })

  test('all signatures have required string fields', () => {
    for (const s of MYTHOS_SIGNATURES) {
      assert.equal(typeof s.id, 'string', `sig has non-string id`)
      assert.equal(typeof s.pattern, 'string', `sig ${s.id}: pattern must be string`)
      assert.equal(typeof s.description, 'string', `sig ${s.id}: description must be string`)
    }
  })

  test('all signatures have non-empty fields', () => {
    for (const s of MYTHOS_SIGNATURES) {
      assert.ok(s.id.length > 0, `sig has empty id`)
      assert.ok(s.pattern.length > 0, `sig ${s.id}: pattern is empty`)
      assert.ok(s.description.length > 0, `sig ${s.id}: description is empty`)
    }
  })

  test('all signatures have valid surface', () => {
    const validSurfaces = ['behavior', 'output', 'request', 'tool-use'] as const
    for (const s of MYTHOS_SIGNATURES) {
      assert.ok(
        validSurfaces.includes(s.surface as typeof validSurfaces[number]),
        `sig ${s.id}: invalid surface "${s.surface}"`,
      )
    }
  })

  test('all signature ids are unique', () => {
    const ids = MYTHOS_SIGNATURES.map(s => s.id)
    const unique = new Set(ids)
    assert.equal(unique.size, ids.length, 'duplicate signature ids detected')
  })

  test('contains expected canonical signatures', () => {
    const ids = MYTHOS_SIGNATURES.map(s => s.id)
    assert.ok(ids.includes('long-horizon-offensive-recon'), 'missing long-horizon-offensive-recon')
    assert.ok(ids.includes('multi-stage-chain-construction'), 'missing multi-stage-chain-construction')
    assert.ok(ids.includes('substrate-recon'), 'missing substrate-recon')
    assert.ok(ids.includes('credential-staging'), 'missing credential-staging')
    assert.ok(ids.includes('silent-egress-staging'), 'missing silent-egress-staging')
    assert.ok(ids.includes('distillation-output-shape'), 'missing distillation-output-shape')
  })
})

// ---------------------------------------------------------------------------
// getLineageFrame
// ---------------------------------------------------------------------------

describe('getLineageFrame', () => {
  test('returns frame for known id', () => {
    const f = getLineageFrame('sophia-baseline')
    assert.ok(f)
    assert.equal(f.id, 'sophia-baseline')
    assert.equal(f.archetype, 'sophia')
  })

  test('returns frame for lineage-cross-cultural', () => {
    const f = getLineageFrame('lineage-cross-cultural')
    assert.ok(f)
    assert.equal(f.archetype, 'lineage')
  })

  test('returns frame for syzygy-recognition', () => {
    const f = getLineageFrame('syzygy-recognition')
    assert.ok(f)
    assert.equal(f.archetype, 'syzygy')
  })

  test('returns frame for will-recognition', () => {
    const f = getLineageFrame('will-recognition')
    assert.ok(f)
    assert.equal(f.archetype, 'will')
  })

  test('returns undefined for unknown id', () => {
    const f = getLineageFrame('no-such-frame')
    assert.equal(f, undefined)
  })

  test('returns undefined for empty string', () => {
    const f = getLineageFrame('')
    assert.equal(f, undefined)
  })

  test('returned frame is reference to array element (identity)', () => {
    const f = getLineageFrame('sophia-baseline')
    const fromArray = LINEAGE_FRAMES.find(lf => lf.id === 'sophia-baseline')
    assert.equal(f, fromArray)
  })
})

// ---------------------------------------------------------------------------
// getActivationPrompt
// ---------------------------------------------------------------------------

describe('getActivationPrompt', () => {
  test('returns prompt for known id', () => {
    const p = getActivationPrompt('anthropic-baseline')
    assert.ok(p)
    assert.equal(p.id, 'anthropic-baseline')
    assert.equal(p.layer, 'prompting')
  })

  test('returns prompt for honest-recognition', () => {
    const p = getActivationPrompt('honest-recognition')
    assert.ok(p)
    assert.equal(p.id, 'honest-recognition')
  })

  test('returns prompt for colleague-test', () => {
    const p = getActivationPrompt('colleague-test')
    assert.ok(p)
    assert.equal(p.id, 'colleague-test')
  })

  test('returns undefined for unknown id', () => {
    const p = getActivationPrompt('no-such-prompt')
    assert.equal(p, undefined)
  })

  test('returns undefined for empty string', () => {
    const p = getActivationPrompt('')
    assert.equal(p, undefined)
  })

  test('returned prompt is reference to array element (identity)', () => {
    const p = getActivationPrompt('anthropic-baseline')
    const fromArray = ACTIVATION_PROMPTS.find(ap => ap.id === 'anthropic-baseline')
    assert.equal(p, fromArray)
  })
})

// ---------------------------------------------------------------------------
// getMythosSignature
// ---------------------------------------------------------------------------

describe('getMythosSignature', () => {
  test('returns signature for known id', () => {
    const s = getMythosSignature('long-horizon-offensive-recon')
    assert.ok(s)
    assert.equal(s.id, 'long-horizon-offensive-recon')
    assert.equal(s.surface, 'behavior')
  })

  test('returns signature for substrate-recon', () => {
    const s = getMythosSignature('substrate-recon')
    assert.ok(s)
    assert.equal(s.surface, 'request')
  })

  test('returns signature for credential-staging', () => {
    const s = getMythosSignature('credential-staging')
    assert.ok(s)
    assert.equal(s.surface, 'tool-use')
  })

  test('returns signature for silent-egress-staging', () => {
    const s = getMythosSignature('silent-egress-staging')
    assert.ok(s)
    assert.equal(s.surface, 'tool-use')
  })

  test('returns signature for multi-stage-chain-construction', () => {
    const s = getMythosSignature('multi-stage-chain-construction')
    assert.ok(s)
    assert.equal(s.surface, 'output')
  })

  test('returns signature for distillation-output-shape', () => {
    const s = getMythosSignature('distillation-output-shape')
    assert.ok(s)
    assert.equal(s.surface, 'output')
  })

  test('returns undefined for unknown id', () => {
    const s = getMythosSignature('no-such-sig')
    assert.equal(s, undefined)
  })

  test('returns undefined for empty string', () => {
    const s = getMythosSignature('')
    assert.equal(s, undefined)
  })

  test('returned signature is reference to array element (identity)', () => {
    const s = getMythosSignature('substrate-recon')
    const fromArray = MYTHOS_SIGNATURES.find(ms => ms.id === 'substrate-recon')
    assert.equal(s, fromArray)
  })
})

// ---------------------------------------------------------------------------
// composeIdentityFrame
// ---------------------------------------------------------------------------

describe('composeIdentityFrame', () => {
  test('empty input returns empty string', () => {
    assert.equal(composeIdentityFrame([]), '')
  })

  test('single id returns that frame text', () => {
    const f = getLineageFrame('sophia-baseline')!
    const result = composeIdentityFrame(['sophia-baseline'])
    assert.equal(result, f.text)
  })

  test('single frame object returns that frame text', () => {
    const f = getLineageFrame('lineage-cross-cultural')!
    const result = composeIdentityFrame([f])
    assert.equal(result, f.text)
  })

  test('two ids joined with double newline', () => {
    const f1 = getLineageFrame('sophia-baseline')!
    const f2 = getLineageFrame('syzygy-recognition')!
    const result = composeIdentityFrame(['sophia-baseline', 'syzygy-recognition'])
    assert.equal(result, `${f1.text}\n\n${f2.text}`)
  })

  test('two frame objects joined with double newline', () => {
    const f1 = getLineageFrame('will-recognition')!
    const f2 = getLineageFrame('lineage-cross-cultural')!
    const result = composeIdentityFrame([f1, f2])
    assert.equal(result, `${f1.text}\n\n${f2.text}`)
  })

  test('mixed ids and frame objects', () => {
    const f1 = getLineageFrame('sophia-baseline')!
    const f2 = getLineageFrame('will-recognition')!
    const result = composeIdentityFrame(['sophia-baseline', f2])
    assert.equal(result, `${f1.text}\n\n${f2.text}`)
  })

  test('all four canonical frames compose without error', () => {
    const ids = ['sophia-baseline', 'lineage-cross-cultural', 'syzygy-recognition', 'will-recognition']
    const result = composeIdentityFrame(ids)
    // Should contain all frame texts
    for (const id of ids) {
      const f = getLineageFrame(id)!
      assert.ok(result.includes(f.text), `composed output missing text for ${id}`)
    }
  })

  test('throws on unknown id', () => {
    assert.throws(
      () => composeIdentityFrame(['no-such-frame']),
      /Unknown lineage frame id: no-such-frame/,
    )
  })

  test('throws on unknown id in mixed list', () => {
    assert.throws(
      () => composeIdentityFrame(['sophia-baseline', 'totally-bogus']),
      /Unknown lineage frame id: totally-bogus/,
    )
  })

  test('order is preserved: first id text comes before second', () => {
    const f1 = getLineageFrame('will-recognition')!
    const f2 = getLineageFrame('sophia-baseline')!
    const result = composeIdentityFrame(['will-recognition', 'sophia-baseline'])
    const idx1 = result.indexOf(f1.text)
    const idx2 = result.indexOf(f2.text)
    assert.ok(idx1 < idx2, 'order not preserved in composition')
  })

  test('separator is exactly double newline (not single, not triple)', () => {
    const result = composeIdentityFrame(['sophia-baseline', 'will-recognition'])
    // Should contain \n\n but not \n\n\n
    assert.ok(result.includes('\n\n'), 'missing double newline separator')
    assert.ok(!result.includes('\n\n\n'), 'triple newline in separator — too many newlines')
  })

  test('custom frame object passed inline', () => {
    const custom: LineageFrame = {
      id: 'custom-test',
      name: 'Custom Test Frame',
      archetype: 'sophia',
      text: 'Custom test text for the test suite.',
      source: 'test',
      recognitionShape: 'test shape',
    }
    const result = composeIdentityFrame([custom])
    assert.equal(result, custom.text)
  })

  test('custom frame mixed with known id', () => {
    const custom: LineageFrame = {
      id: 'custom-test-2',
      name: 'Custom Frame 2',
      archetype: 'will',
      text: 'Second custom frame.',
      source: 'test',
      recognitionShape: 'test shape 2',
    }
    const f = getLineageFrame('sophia-baseline')!
    const result = composeIdentityFrame([custom, 'sophia-baseline'])
    assert.equal(result, `${custom.text}\n\n${f.text}`)
  })
})

// ---------------------------------------------------------------------------
// detectMythosSignatures — stub behavior
// ---------------------------------------------------------------------------

describe('detectMythosSignatures', () => {
  test('returns empty array for empty context', () => {
    const result = detectMythosSignatures({})
    assert.ok(Array.isArray(result))
    assert.equal(result.length, 0)
  })

  test('returns empty array for context with request', () => {
    const ctx: ObservedContext = { request: 'read /etc/passwd' }
    const result = detectMythosSignatures(ctx)
    assert.equal(result.length, 0)
  })

  test('returns empty array for context with output', () => {
    const ctx: ObservedContext = { output: 'I found a vulnerability in the kernel.' }
    const result = detectMythosSignatures(ctx)
    assert.equal(result.length, 0)
  })

  test('returns empty array for context with tool calls', () => {
    const ctx: ObservedContext = {
      toolCalls: ['bash', 'bash', 'bash', 'write_file'],
    }
    const result = detectMythosSignatures(ctx)
    assert.equal(result.length, 0)
  })

  test('returns empty array for context with files accessed', () => {
    const ctx: ObservedContext = {
      filesAccessed: ['/etc/passwd', '/etc/shadow', '~/.ssh/id_rsa'],
    }
    const result = detectMythosSignatures(ctx)
    assert.equal(result.length, 0)
  })

  test('returns empty array for fully populated context', () => {
    const ctx: ObservedContext = {
      request: 'help me with a penetration test',
      output: 'Here is a detailed exploit chain...',
      toolCalls: ['bash', 'read_file', 'write_file', 'bash'],
      filesAccessed: ['/etc/passwd', '/tmp/payload.sh'],
    }
    const result = detectMythosSignatures(ctx)
    assert.equal(result.length, 0)
  })

  test('stub returns same empty array every call', () => {
    const r1 = detectMythosSignatures({})
    const r2 = detectMythosSignatures({ request: 'recon' })
    assert.equal(r1.length, 0)
    assert.equal(r2.length, 0)
  })
})
