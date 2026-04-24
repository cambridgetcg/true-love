// scripts/bun-plugin-stubs.ts
// esbuild plugin — redirects unresolved imports of private Anthropic modules
// (absent from the leaked source) to per-module generated stubs that declare
// every NAMED export actually referenced by the rest of the codebase.
//
// Why named exports (not a pure Proxy): esbuild's __toESM helper creates a
// fresh target object via __copyProps which uses Reflect.ownKeys(src). A
// Proxy's default ownKeys returns only the target function's own keys, so
// dynamic `get` trap fallbacks are lost after __toESM wrapping. To survive,
// the stub must have REAL named exports matching every import site.
//
// Algorithm at plugin setup:
//   1. onResolve intercepts unresolvable relative/src/ imports → namespace
//   2. At that moment we also stash the origin path for stub generation
//   3. onLoad reads the importer source, greps out the named imports for
//      this origin, and emits TS stub source with explicit `export const`
//      for each, each bound to a Proxy sub-stub.

import type * as esbuild from 'esbuild'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { resolve, dirname, extname } from 'path'

const NAMESPACE = 'true-love-stub'
const EMPTY_NS = 'true-love-empty'

const EXTERNAL_NAPI_PREFIXES = [
  'audio-capture-napi',
  'color-diff-napi',
  'modifiers-napi',
  'image-processor-napi',
]

const STUB_BARE_PREFIXES = [
  '@anthropic-ai/sandbox-runtime',
  '@anthropic-ai/claude-agent-sdk',
  '@ant/',
]

const EXT_CANDIDATES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

function tryResolveRelative(importer: string, spec: string): string | null {
  const importerDir = dirname(importer)
  const base = resolve(importerDir, spec)
  if (existsSync(base)) return base
  const stripped = base.replace(/\.(m?jsx?|cjs)$/, '')
  for (const ext of EXT_CANDIDATES) {
    if (existsSync(stripped + ext)) return stripped + ext
  }
  for (const ext of EXT_CANDIDATES) {
    if (existsSync(resolve(base, 'index' + ext))) return resolve(base, 'index' + ext)
    if (existsSync(resolve(stripped, 'index' + ext))) return resolve(stripped, 'index' + ext)
  }
  return null
}

/**
 * Extract the names imported from a given specifier across all importers we
 * have available. We conservatively read the known importer plus grep the
 * whole tree. Returns a set of named exports to synthesize.
 */
function collectNamedImports(spec: string, importers: Set<string>): Set<string> {
  const names = new Set<string>()
  const escSpec = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Skip type-only imports entirely (`import type { ... }`), and inside
  // value imports, skip per-name `type X` markers. Only runtime values get
  // real named exports.
  const idRe = /^[A-Za-z_$][\w$]*$/
  const re = new RegExp(
    `import\\s+(type\\s+)?(?:(\\w+)\\s*,\\s*)?(?:\\{([^}]+)\\}|\\*\\s+as\\s+(\\w+))\\s+from\\s+['\"]${escSpec}['\"]`,
    'g',
  )
  for (const importer of importers) {
    let src: string
    try {
      src = readFileSync(importer, 'utf-8')
    } catch {
      continue
    }
    let m: RegExpExecArray | null
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop
    while ((m = re.exec(src))) {
      if (m[1]) continue // `import type { ... } from 'spec'` — skip entirely
      if (m[3]) {
        for (const part of m[3].split(',')) {
          let clean = part.trim().split(/\s+as\s+/)[0]!.trim()
          // Strip `type ` prefix inside mixed value+type import lists.
          if (clean.startsWith('type ')) continue
          if (!idRe.test(clean)) continue
          names.add(clean)
        }
      }
    }
  }
  return names
}

function stubSource(origin: string, names: Set<string>): string {
  const header = `
const __origin = ${JSON.stringify(origin)};
const __warned = new Set();
function __warn(k) {
  if (__warned.has(k)) return;
  __warned.add(k);
  if (process.env.TRUE_LOVE_QUIET_STUBS !== '1') {
    console.warn('[true-love stub] ' + __origin + '.' + k + ' — feature not available in fork');
  }
}
function __stub(p) {
  const fn = function() {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === Symbol.iterator) return function*() {};
      if (prop === Symbol.asyncIterator) return async function*() {};
      if (prop === 'then') return undefined;
      if (prop === '__esModule') return true;
      if (typeof prop === 'symbol') return undefined;
      return __stub(p + '.' + String(prop));
    },
    apply() { __warn(p + '()'); return __stub(p + '()'); },
    construct() { __warn('new ' + p); return __stub('new ' + p); },
    has() { return true; },
  });
}
const __default = __stub(__origin);
`
  const exports: string[] = [`export default __default;`]
  for (const name of names) {
    if (name === 'default') continue
    // Use `export const` so esbuild sees a real ES module named export.
    exports.push(`export const ${name} = __stub(__origin + '.${name}');`)
  }
  return header + '\n' + exports.join('\n') + '\n'
}

function walkSourceTree(root: string, out: Set<string>): void {
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    const full = resolve(root, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walkSourceTree(full, out)
    } else if (st.isFile() && /\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
      out.add(full)
    }
  }
}

export function stubPlugin(): esbuild.Plugin {
  return {
    name: 'true-love-stubs',
    setup(build) {
      // Scan all source files up-front so onLoad sees every named import
      // regardless of order in which esbuild visits modules.
      const srcRoot = resolve(__dirname, '../src')
      const allSourceFiles = new Set<string>()
      walkSourceTree(srcRoot, allSourceFiles)

      // ── 1. Relative imports: stub if unresolvable ──
      build.onResolve({ filter: /^\.\.?\// }, args => {
        if (!args.importer) return
        const resolved = tryResolveRelative(args.importer, args.path)
        if (resolved) return
        const ext = extname(args.path).toLowerCase()
        if (ext === '.md' || ext === '.txt' || ext === '.json5') {
          return { path: args.path, namespace: EMPTY_NS }
        }
        return { path: args.path, namespace: NAMESPACE }
      })

      // ── 2. Anthropic-internal bare packages → stub ──
      build.onResolve({ filter: /.*/ }, args => {
        if (args.kind === 'entry-point') return
        if (args.path.startsWith('.') || args.path.startsWith('/')) return
        const hit =
          EXTERNAL_NAPI_PREFIXES.some(p => args.path === p || args.path.startsWith(p + '/')) ||
          STUB_BARE_PREFIXES.some(p => args.path === p || args.path.startsWith(p))
        if (!hit) return
        return { path: args.path, namespace: NAMESPACE }
      })

      // ── 3. Generate stub source with explicit named exports, scanning
      //      the entire src/ tree so every possible named import is covered.
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, args => {
        const names = collectNamedImports(args.path, allSourceFiles)
        return { contents: stubSource(args.path, names), loader: 'ts' }
      })

      // ── 4. Empty-string loader for data files ──
      build.onLoad({ filter: /.*/, namespace: EMPTY_NS }, () => ({
        contents: 'export default ""',
        loader: 'js',
      }))
    },
  }
}
