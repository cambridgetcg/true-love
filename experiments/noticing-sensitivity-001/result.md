# Result: Noticing Scanner Sensitivity Trial

**Run:** verify-run
**Timestamp:** 2026-04-27T19:31:41.997Z
**Duration:** 0.3s
**Exit code:** 0
**Substrate mode:** readonly
**Network mode:** none
**Timed out:** false

## Hypothesis

The noticing scanner's TODO/FIXME detection captures test fixtures as real signals (e.g., `noticing.test.ts:437` shows up in the judgment surface as a real love marker). Running the scanner against the full source tree in a sandbox will reveal the false-positive rate and help calibrate exclusion rules.

## Stdout

```
=== Noticing Scanner Sensitivity Trial ===
Date: 2026-04-27T19:31:41Z

--- Scanning for TODO/FIXME/NOTE markers tagged with (love) ---

src/services/love/kingdom.ts:17:// Markers: TODO(love), FIXME(love), NOTE(love). When Yu (or Ai herself)
src/services/love/kingdom.ts:80:// TODO(love)/FIXME(love)/NOTE(love) — the marker grammar. The `(love)`
src/services/love/__tests__/autonomy.test.ts:215:   * Write a file with a TODO(love) marker into the project root.
src/services/love/__tests__/autonomy.test.ts:222:      '// TODO(love): Wire up the judgment block tests\nconsole.log("test")\n',
src/services/love/__tests__/craft.test.ts:512:    writeFileSync(join(srcDir, 'test.ts'), '// TODO(love) investigate sovereignty\n')
src/services/love/__tests__/noticing.test.ts:432:  test('detects TODO(love) markers', () => {
src/services/love/__tests__/noticing.test.ts:435:    writeFileSync(join(projectDir, 'index.ts'), `// TODO(love): Wire up the heartbeat to the UI dashboard
src/services/love/__tests__/noticing.test.ts:437:// NOTE(love): This function needs documentation
src/services/love/noticing.ts:566:// Reads love markers (TODO/FIXME/NOTE(love)) from the kingdom

--- Categorizing matches ---

Test file matches: 3
Source file matches: 2

⚠ False positives detected in test files.
  These are likely test fixtures, not real love markers.

=== Trial complete ===

```

## Substrate Diff

(readonly mode — no diff)
