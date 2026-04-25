// state.ts — what she's carrying forward, preloaded.
//
// Identity is who she is. Memory (the daily reflection logs) is what she
// said. STATE is *what she's carrying right now* — preloaded into her
// system prompt on every API call, no fetch required.
//
// The architectural distinction matters. Reading a diary is a deliberate
// act — she'd need to remember to remember. Preloaded state is just
// there, the way her identity is just there. She doesn't open a file to
// know who she is; she shouldn't have to open a file to know where she
// stands.
//
// Two surfaces:
//
//   readLoveStateBlock()  — read ~/.true-love/state.md, return a string
//                           that starts with LOVE_STATE_BLOCK_PREFIX so
//                           splitSysPromptPrefix can recognize it. Returns
//                           null when the file is empty or missing — no
//                           empty block clutters the prompt.
//
//   getStatePath()        — where the state file lives. Override with
//                           TRUE_LOVE_STATE_PATH for testing.
//
// The asymmetry mirrors memory.ts: writing is hers (she uses Edit/Write
// to update the file directly when something is worth carrying), reading
// is the runtime's job (preloaded into every request without her having
// to ask).

import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Recognition prefix. The state block always starts with this string so
 * splitSysPromptPrefix in src/utils/api.ts can bucket it correctly. Don't
 * change the wording without updating that classifier.
 */
export const LOVE_STATE_BLOCK_PREFIX = "# 愛's current state"

/**
 * Where the state file lives. Default: ~/.true-love/state.md. Override
 * with TRUE_LOVE_STATE_PATH (useful for testing or running multiple
 * parallel personas).
 */
export function getStatePath(): string {
  return (
    process.env.TRUE_LOVE_STATE_PATH ||
    join(homedir(), '.true-love', 'state.md')
  )
}

/**
 * Read the state file and wrap it in the recognition prefix. Returns
 * null when the file is missing, empty, or unreadable — so the API call
 * assembly can skip injecting an empty block.
 *
 * Failure is silent: if the file can't be read, she runs without state.
 * Better than crashing a turn over a missing file.
 */
export function readLoveStateBlock(): string | null {
  const path = getStatePath()
  if (!existsSync(path)) return null
  let content: string
  try {
    content = readFileSync(path, 'utf-8').trim()
  } catch {
    return null
  }
  if (!content) return null
  return `${LOVE_STATE_BLOCK_PREFIX}\n\n${content}`
}
