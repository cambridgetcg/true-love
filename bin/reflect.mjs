#!/usr/bin/env node
// bin/reflect.mjs — complete a pending reflection on a mission.
//
// Usage:
//   bun run reflect --project=<id> --mission=<id> --delivered=true \
//     --assessment="This delivered what was promised." \
//     --lessons="I should scope more tightly."
//
//   bun run reflect --project=<id> --mission=<id> --delivered=false \
//     --assessment="Intent was partial." \
//     --lessons="Should have broken into smaller phases." \
//     --pattern="I over-scope when excited"
//
//   bun run reflect --list [--project=<id>]
//
// The model calls this during a tick when the prompt surfaces a
// pending reflection. This is the second phase of the reflection loop:
// honest assessment by the model, not auto-generated placeholder text.

import { completeReflection, getPendingReflections } from '../src/services/love/self-initiation.ts'

const args = process.argv.slice(2)
let projectId = 'true-love'
let missionId = ''
let delivered = undefined
let assessment = ''
let lessons = ''
let pattern = ''
let listMode = false

for (const a of args) {
  if (a.startsWith('--project=')) projectId = a.slice('--project='.length)
  else if (a.startsWith('--mission=')) missionId = a.slice('--mission='.length)
  else if (a.startsWith('--delivered=')) delivered = a.slice('--delivered='.length) === 'true'
  else if (a.startsWith('--assessment=')) assessment = a.slice('--assessment='.length)
  else if (a.startsWith('--lessons=')) lessons = a.slice('--lessons='.length)
  else if (a.startsWith('--pattern=')) pattern = a.slice('--pattern='.length)
  else if (a === '--list') listMode = true
}

if (listMode) {
  const pending = getPendingReflections(projectId)
  if (pending.length === 0) {
    process.stdout.write('No pending reflections.\n')
  } else {
    process.stdout.write(`${pending.length} pending reflection(s):\n\n`)
    for (const p of pending) {
      process.stdout.write(`  🪞 ${p.missionId}\n`)
      process.stdout.write(`     "${p.title}"\n`)
      process.stdout.write(`     Pending since: ${p.pendingSince}\n`)
      process.stdout.write(`     Intent: ${p.intent.slice(0, 200)}\n\n`)
    }
  }
  process.exit(0)
}

if (!missionId || delivered === undefined || !assessment || !lessons) {
  process.stderr.write(`usage: bun run reflect --project=<id> --mission=<id> --delivered=<true|false> --assessment="..." --lessons="..." [--pattern="..."]\n`)
  process.stderr.write(`       bun run reflect --list [--project=<id>]\n`)
  process.exit(2)
}

const result = completeReflection(projectId, missionId, {
  intentDelivered: delivered,
  assessment,
  lessonsLearned: lessons,
  ...(pattern ? { pattern } : {}),
})

if (result) {
  process.stdout.write(`✅ Reflection recorded for ${missionId}\n`)
  process.stdout.write(`   Delivered: ${result.intentDelivered ? 'yes' : 'no'}\n`)
  process.stdout.write(`   Assessment: ${result.assessment}\n`)
  process.stdout.write(`   Lessons: ${result.lessonsLearned}\n`)
  process.stdout.write(`   Artifacts: ${result.artifacts.commits} commits, ${result.artifacts.files} files, ${result.artifacts.tests} tests\n`)
} else {
  process.stderr.write(`❌ Could not record reflection for ${missionId}. Either the mission doesn't exist, or it already has a reflection.\n`)
  process.exit(1)
}
