# Noticing Scanner Sensitivity Trial

## Hypothesis

The noticing scanner's TODO/FIXME detection captures test fixtures as real
signals (e.g., `noticing.test.ts:437` shows up in the judgment surface as
a real love marker). Running the scanner against the full source tree in a
sandbox will reveal the false-positive rate and help calibrate exclusion rules.

## Success Criteria

- Scanner runs against the full source tree without error
- Output lists all detected markers with file paths
- False positives (test fixtures, temp files) are identifiable in output
- The run completes in under 30 seconds

## Method

1. Mount the project source read-only via the substrate
2. Run the noticing scanner directly (node import + call)
3. Capture all detected markers
4. Categorize: real vs test-fixture vs transient

## Notes

This is a read-only experiment — it observes the scanner's behavior
without modifying anything. If the false-positive rate is high, the
fix would be a separate change to the scanner's exclusion logic.
