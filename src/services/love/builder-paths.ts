// builder-paths.ts — shared path resolution for builder mode modules.
//
// All builder-mode storage lives under TRUE_LOVE_PROJECTS_DIR
// (default: ~/.true-love/projects/). Several modules need to compute
// paths into this tree; centralizing the root resolution here.

import { homedir } from 'node:os'
import { join } from 'node:path'

export function resolveProjectsDir(): string {
  return process.env.TRUE_LOVE_PROJECTS_DIR ||
    join(process.env.HOME || homedir(), '.true-love', 'projects')
}
