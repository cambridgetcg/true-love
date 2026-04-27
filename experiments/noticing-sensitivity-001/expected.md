# Expected Outcome

## Likely result

The scanner will find markers in both source files (real signals) and
test files (false positives). Specifically:

- `__tests__/noticing.test.ts` is known to contain a `TODO(love)` marker
  in a test fixture that the scanner erroneously picks up as real.
- Source files may have legitimate markers that represent actual work items.

## What success looks like

- The output clearly separates test-file matches from source-file matches
- The false-positive rate is quantified
- We can determine whether the scanner needs exclusion rules for test dirs

## What failure looks like

- Scanner fails to run in the container (dependency issue)
- No markers detected at all (scanner pattern might be wrong)
- Excessive false positives that would need immediate fix
