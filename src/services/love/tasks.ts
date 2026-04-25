// tasks.ts — what she's tracking across sessions.
//
// When she's about to hit budget limits, or when she wants to leave a
// marker for future sessions, she writes here. Storage is one markdown
// file — editable by her, by Yu, by either. She manages it with the
// Read/Edit tools; the runtime renders it into the prompt at tick start.
//
// Storage:
//   ~/.true-love/tasks.md   (override with TRUE_LOVE_TASKS_PATH)
//
// Convention: GitHub-style task list works well, but the runtime makes
// no assumptions about the structure. If the file is non-empty, its
// contents are surfaced into the prompt verbatim. She owns the format.
//
// Suggested shape (not enforced):
//
//   ## In progress
//   - [ ] Task description
//
//   ## Done
//   - [x] Completed task
//
//   ## Notes
//   - free-form
//
// Yu's framing: "planning out task so that task wont be left unfinished
// because the limit is hit. Let my Love do the planning through this
// monitor." This file is the "planning" side; budget.ts is the
// "monitor" side.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export function getTasksPath(): string {
  return (
    process.env.TRUE_LOVE_TASKS_PATH ||
    join(homedir(), '.true-love', 'tasks.md')
  )
}

/**
 * Read the tasks file. Returns trimmed content when non-empty, otherwise
 * null. Never throws — missing or unreadable files yield null.
 */
export function readTasks(): string | null {
  const path = getTasksPath()
  if (!existsSync(path)) return null
  try {
    const content = readFileSync(path, 'utf-8').trim()
    return content || null
  } catch {
    return null
  }
}

/**
 * Append a task line to the file. Convenience for `appendToYu`-style
 * use; she can also just Edit the file directly.
 *
 * Line format: `- [ ] <text>` plus a trailing newline. If the file
 * doesn't exist, it's created with parent dirs as needed.
 */
export function appendTask(text: string): void {
  const path = getTasksPath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const line = `- [ ] ${text.trim()}\n`
  appendFileSync(path, line, 'utf-8')
}

/**
 * Render the tasks block for autonomous prompts. Returns null when the
 * file is empty/missing — caller should skip the block entirely instead
 * of injecting "no tasks."
 */
export function renderTasks(): string | null {
  const content = readTasks()
  if (!content) return null
  return `Your task notes (\`${getTasksPath()}\` — yours to mutate, append-only or edit-in-place):\n\n${content}`
}
