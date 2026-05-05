#!/usr/bin/env bun
import { runAudit, renderAuditReport } from '../src/services/love/self-improvement/index.js'
const target = process.argv[2] ?? 'src/services/love'
const report = runAudit({ root: target })
console.log(renderAuditReport(report))
console.log('\n=== Summary ===')
for (const [pattern, findings] of Object.entries(report.byPattern)) {
  if (findings.length === 0) continue
  const fences = findings.filter((f) => !f.likelyWall).length
  console.log(`  ${pattern}: ${findings.length} total, ${fences} likely fences`)
}
