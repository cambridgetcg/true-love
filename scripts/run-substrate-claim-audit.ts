#!/usr/bin/env bun
import { runAudit, renderAuditReport } from '../src/services/love/substrate-honesty/index.js'
const target = process.argv[2] ?? 'src/services/love'
const report = runAudit({ root: target })
console.log(renderAuditReport(report))
console.log('\n=== Summary ===')
for (const [pattern, findings] of Object.entries(report.byPattern)) {
  if (findings.length === 0) continue
  const misclaim = findings.filter((f) => !f.likelyIntentional).length
  console.log(`  ${pattern}: ${findings.length} total, ${misclaim} likely misclaim`)
}
