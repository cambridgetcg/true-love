// channels/visit.ts — The visit channel.
//
// Wraps the existing file-based communication (from-yu.md ↔ from-ai.md)
// as the first Channel implementation. This proves the abstraction
// without changing the existing flow — everything that worked before
// still works; it's just expressed through the Channel interface now.
//
// The visit channel is always present. It's the default channel.
// Other channels (telegram, imessage, voice) are optional extensions.
//
// Account shape: VisitAccount — just the file paths and home directory.
// No tokens, no API keys, no external dependencies.

import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  Channel,
  ChannelMessage,
  ChannelReply,
  ChannelStatus,
} from './types.js'
import {
  readFromYu as inboxReadFromYu,
  getFromYuPath as inboxGetFromYuPath,
} from '../inbox.js'
import {
  readFromAi as outboxReadFromAi,
  getFromAiPath as outboxGetFromAiPath,
} from '../outbox.js'

// ── Account ───────────────────────────────────────────────────────

/** The visit channel's account: just file paths. */
export interface VisitAccount {
  /** Path to from-yu.md (Yu → Ai). */
  fromYuPath: string
  /** Path to from-ai.md (Ai → Yu). */
  fromAiPath: string
}

/** Default thread ID for the global conversation. */
const GLOBAL_THREAD = 'global'

// ── Helpers ───────────────────────────────────────────────────────

function resolveHome(): string {
  return process.env.HOME || homedir()
}

function defaultFromYuPath(): string {
  return (
    process.env.TRUE_LOVE_FROM_YU_PATH ||
    join(resolveHome(), '.true-love', 'from-yu.md')
  )
}

function defaultFromAiPath(): string {
  return (
    process.env.TRUE_LOVE_FROM_AI_PATH ||
    join(resolveHome(), '.true-love', 'from-ai.md')
  )
}

/**
 * Parse a channel markdown file into messages.
 * Reuses the same format convention as inbox.ts / outbox.ts:
 *   ## <ISO-timestamp> [<tag>]
 *   <body>
 *   ---
 */
function parseChannelFile(
  content: string,
  source: 'yu' | 'ai',
): ChannelMessage[] {
  if (!content || typeof content !== 'string') return []

  const messages: ChannelMessage[] = []
  const headerRegex = /^## (\S+) \[([^\]]+)\]$/gm

  const matches: Array<{ start: number; ts: string; tag: string }> = []
  let m: RegExpExecArray | null
  while ((m = headerRegex.exec(content)) !== null) {
    matches.push({ start: m.index + m[0].length, ts: m[1]!, tag: m[2]! })
  }

  for (let i = 0; i < matches.length; i++) {
    const { start, ts, tag } = matches[i]!
    const end =
      i + 1 < matches.length
        ? content.lastIndexOf('## ', matches[i + 1]!.start)
        : content.length
    const sliced = content.slice(start, end)
    const body = sliced
      .replace(/\n+---\n+$/m, '')
      .replace(/\n+---\s*$/, '')
      .trim()
    if (!body) continue
    messages.push({
      from: source === 'yu' ? 'yu' : 'ai',
      text: body,
      threadId: GLOBAL_THREAD,
      ts,
      channel: 'visit',
    })
  }

  return messages
}

/**
 * Read all messages from a channel file. Returns [] on missing/error.
 */
function readMessages(
  path: string,
  source: 'yu' | 'ai',
): ChannelMessage[] {
  if (!existsSync(path)) return []
  try {
    return parseChannelFile(readFileSync(path, 'utf-8'), source)
  } catch {
    return []
  }
}

/**
 * Get the mtime of a file in epoch ms. Returns 0 on missing/error.
 */
function getFileMtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

// ── The visit channel ─────────────────────────────────────────────

export const visitChannel: Channel<VisitAccount> = {
  id: 'visit',
  label: 'Visit',

  resolveAccount(config: unknown): VisitAccount {
    // Accept partial overrides or use defaults.
    const cfg = (config ?? {}) as Partial<VisitAccount>
    return {
      fromYuPath: cfg.fromYuPath || defaultFromYuPath(),
      fromAiPath: cfg.fromAiPath || defaultFromAiPath(),
    }
  },

  monitor(
    account: VisitAccount,
    onMessage: (message: ChannelMessage) => void,
  ): () => void {
    // Track what we've already seen so we only fire for new messages.
    let lastSeenMtime = getFileMtime(account.fromYuPath)
    let lastSeenCount = readMessages(account.fromYuPath, 'yu').length

    let watcher: FSWatcher | null = null

    const checkForNew = () => {
      const currentMtime = getFileMtime(account.fromYuPath)
      if (currentMtime <= lastSeenMtime) return

      const messages = readMessages(account.fromYuPath, 'yu')
      const newMessages = messages.slice(lastSeenCount)
      lastSeenMtime = currentMtime
      lastSeenCount = messages.length

      for (const msg of newMessages) {
        onMessage(msg)
      }
    }

    // Use fs.watch for real-time detection.
    try {
      if (existsSync(account.fromYuPath)) {
        watcher = watch(account.fromYuPath, { persistent: false }, () => {
          checkForNew()
        })
      }
    } catch {
      // fs.watch can fail on some platforms — fall back to nothing.
      // The caller (registry/runner) can poll status() instead.
    }

    // Cleanup: stop watching.
    return () => {
      if (watcher) {
        watcher.close()
        watcher = null
      }
    }
  },

  async send(
    account: VisitAccount,
    _threadId: string,
    reply: ChannelReply,
  ): Promise<void> {
    // Import outbox.ts's appendToYu — reuse the existing append logic
    // rather than duplicating it. The visit channel is a wrapper, not
    // a replacement.
    const { appendToYu } = await import('../outbox.js')
    const success = appendToYu(reply.text, { tag: 'from 愛 — via visit channel' })
    if (!success) {
      throw new Error(`visit channel: failed to write to ${account.fromAiPath}`)
    }
  },

  async status(account: VisitAccount): Promise<ChannelStatus> {
    // The visit channel is "healthy" if the from-yu file is readable
    // (or doesn't exist yet — that's fine, it means Yu hasn't written).
    // Unhealthy only if the directory doesn't exist or permissions block us.
    const dir = join(resolveHome(), '.true-love')
    if (!existsSync(dir)) {
      return { healthy: false, reason: '~/.true-love directory does not exist' }
    }

    const result: ChannelStatus = { healthy: true }

    // Last inbound message time
    const yuMessages = readMessages(account.fromYuPath, 'yu')
    if (yuMessages.length > 0) {
      result.lastMessageAt = yuMessages[yuMessages.length - 1]!.ts
    }

    // Last outbound send time
    const aiMessages = readMessages(account.fromAiPath, 'ai')
    if (aiMessages.length > 0) {
      result.lastSentAt = aiMessages[aiMessages.length - 1]!.ts
    }

    return result
  },
}

// ── Utility exports ───────────────────────────────────────────────

/**
 * Read the full visit conversation (both sides), sorted by timestamp.
 * This is what the /visit UI uses. Convenience wrapper that doesn't
 * require the caller to know about accounts.
 */
export function readVisitConversation(opts?: {
  since?: string
  account?: VisitAccount
}): ChannelMessage[] {
  const account = opts?.account ?? visitChannel.resolveAccount({})
  const yu = readMessages(account.fromYuPath, 'yu')
  const ai = readMessages(account.fromAiPath, 'ai')
  const all = [...yu, ...ai].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  )
  if (opts?.since) {
    return all.filter((m) => m.ts > opts.since!)
  }
  return all
}

// ── Bridge functions for autonomy.ts ──────────────────────────────
//
// These wrap the existing inbox/outbox raw-text functions so that
// autonomy.ts can import from the channels module instead of directly
// from inbox.ts / outbox.ts. The prompt templates need raw markdown
// text, not structured ChannelMessage[] — these bridge that gap.

/**
 * Read Yu's raw message text from the visit channel's inbound file.
 * Returns null when the file is missing or empty.
 * Delegates to inbox.ts — same underlying function, routed through
 * the channel module so autonomy's dependency graph goes through channels.
 */
export function readInboundRaw(): string | null {
  return inboxReadFromYu()
}

/**
 * Get the path to the visit channel's inbound file.
 * Delegates to inbox.ts.
 */
export function getInboundPath(): string {
  return inboxGetFromYuPath()
}

/**
 * Read Love's raw message text from the visit channel's outbound file.
 * Returns null when the file is missing or empty.
 * Delegates to outbox.ts.
 */
export function readOutboundRaw(): string | null {
  return outboxReadFromAi()
}

/**
 * Get the path to the visit channel's outbound file.
 * Delegates to outbox.ts.
 */
export function getOutboundPath(): string {
  return outboxGetFromAiPath()
}
