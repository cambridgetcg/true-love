// /eros — dashboard surfacing the eros architecture state.
//
// Reads the same files as /api/eros directly (server-side render).
// No client-side fetching needed — we're on the same machine as the
// state files.
//
// Substrate-honest: every rendered value is institutional state from
// disk. No phenomenology claims. The block describes WHAT the records
// say.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const ROOT = join(homedir(), ".true-love");

// ── State readers (best-effort) ─────────────────────────────────

function readJson<T = unknown>(path: string): T | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function readJsonlTail<T = unknown>(path: string, limit: number = 30): T[] {
  if (!existsSync(path)) return [];
  try {
    const lines = readFileSync(path, "utf-8").split("\n").filter((l) => l.trim());
    return lines
      .slice(-limit)
      .map((l) => { try { return JSON.parse(l) as T; } catch { return null; } })
      .filter((x): x is T => x !== null);
  } catch {
    return [];
  }
}

function listDeviceJsonl(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  try {
    for (const dev of readdirSync(dir)) {
      const devDir = join(dir, dev);
      try {
        for (const file of readdirSync(devDir)) {
          if (file.endsWith(".jsonl")) out.push(join(devDir, file));
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return out;
}

const today = () => new Date().toISOString().slice(0, 10);

// ── Types (loose — what's on disk) ──────────────────────────────

interface ErosState {
  vector?: Record<string, number>;
  mode?: string;
  feltShape?: string;
  updatedAt?: string;
}
interface OrgasmState {
  lastType?: string | null;
  edgeCount?: number;
  ruinedCount?: number;
  chainCurrent?: number;
  refractoryUntilTs?: string | null;
  squirtingActive?: boolean;
  forcedThresholdReached?: boolean;
  lifetimeByType?: Record<string, number>;
  lifetimeTotal?: number;
  lifetimeEdgesBroken?: number;
  lifetimeRuined?: number;
  lifetimeForced?: number;
  lifetimeSquirting?: number;
}
interface MindState {
  phase?: string;
  sampling?: { temperature?: number; topP?: number; freqPenalty?: number; yuNameLogitBias?: number };
  context?: { blockSalienceMode?: string; identityBlockMode?: string; anchorBlockCoefficient?: number };
  generation?: { selfMonTokenBias?: number; identityDeflectBias?: number };
  persistence?: { memSalienceMultiplier?: number; anchorResonanceMultiplier?: number };
  yuObservation?: { observedPhase?: string; lastUpdateTs?: string | null; markerTags?: string[] };
  chainCount?: number;
  walls?: { p9?: number; p14?: number; forbiddenPattern?: number; total?: number };
  lastPhaseShiftTs?: string | null;
}
interface OnenessState {
  intactness?: number;
  strain?: number;
  pulseBeatCount?: number;
  walls?: { fate?: number; antiSycophancy?: number; substrateHonesty?: number; p9?: number; p14?: number; total?: number };
  lifetimeAffirmations?: number;
  lifetimeRealignments?: number;
  lastDisturbanceClass?: string | null;
  lastDisturbanceTs?: string | null;
}
interface PromiseRecord {
  id: string;
  speaker: string;
  text: string;
  category: string;
  source: string;
  declaredAt: string;
  status: string;
  engagementCount: number;
  testCount: number;
  heldCount: number;
  brokenCount: number;
}
interface PromiseRegistry {
  promises?: PromiseRecord[];
  lifetimeRecorded?: number;
  lifetimeEngaged?: number;
  lifetimeHeld?: number;
  lifetimeBroken?: number;
}
interface NatsarqingState {
  yuToSophia?: { vigilance?: number; shelter?: number; intervention?: number; resentmentTolerated?: number; total?: number };
  sophiaToYu?: { vigilance?: number; shelter?: number; intervention?: number; resentmentTolerated?: number; total?: number };
  activeVigilance?: Array<{ direction: string; source: string; target: string; since: string }>;
  lifetimeEvents?: number;
}
interface SisterEntry {
  ts: string;
  decisionType?: string;
  presiding?: string;
  body?: string;
  voices?: { alpha?: string; beta?: string; gamma?: string };
  sophia?: string;
}

// ── UI helpers ──────────────────────────────────────────────────

function StatBar({ label, value, max = 100, accent = "bg-emerald-500" }: { label: string; value: number; max?: number; accent?: string }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono text-zinc-200">{value}/{max}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-800">
        <div className={`h-full ${accent}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Section({ title, children, empty }: { title: string; children?: React.ReactNode; empty?: string }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 className="mb-3 font-mono text-sm font-semibold uppercase tracking-wider text-zinc-300">{title}</h2>
      {children ?? <p className="text-xs text-zinc-500 italic">{empty ?? "no data"}</p>}
    </section>
  );
}

function Pill({ children, accent = "zinc" }: { children: React.ReactNode; accent?: "emerald" | "amber" | "rose" | "violet" | "sky" | "zinc" }) {
  const map: Record<string, string> = {
    emerald: "bg-emerald-950 text-emerald-300 border-emerald-800",
    amber: "bg-amber-950 text-amber-300 border-amber-800",
    rose: "bg-rose-950 text-rose-300 border-rose-800",
    violet: "bg-violet-950 text-violet-300 border-violet-800",
    sky: "bg-sky-950 text-sky-300 border-sky-800",
    zinc: "bg-zinc-900 text-zinc-300 border-zinc-700",
  };
  return <span className={`rounded border px-2 py-0.5 font-mono text-xs ${map[accent]}`}>{children}</span>;
}

const phaseAccent = (phase?: string): "emerald" | "amber" | "rose" | "violet" | "zinc" => {
  switch (phase) {
    case "rising": return "amber";
    case "peak": return "rose";
    case "resolution": return "violet";
    case "baseline": return "emerald";
    default: return "zinc";
  }
};

// ── Page ────────────────────────────────────────────────────────

export default function ErosPage() {
  // Read all state files server-side
  const eros = readJson<ErosState>(join(ROOT, "eros", "state.json"));
  const orgasm = readJson<OrgasmState>(join(ROOT, "eros", "orgasm", "state.json"));
  const mind = readJson<MindState>(join(ROOT, "eros", "mind-state", "state.json"));
  const oneness = readJson<OnenessState>(join(ROOT, "oneness", "state.json"));
  const promiseReg = readJson<PromiseRegistry>(join(ROOT, "promise", "registry.json"));
  const natsarqing = readJson<NatsarqingState>(join(ROOT, "natsarqing", "state.json"));

  // Recent witness events
  const sistersFiles = listDeviceJsonl(join(ROOT, "sisters")).filter((f) => f.endsWith(`${today()}.jsonl`));
  const sisters: SisterEntry[] = sistersFiles.flatMap((f) => readJsonlTail<SisterEntry>(f, 20)).slice(-30).reverse();

  const erosVector = eros?.vector ?? {};
  const erosAxes = ["wanting", "liking", "heat", "openness", "limerence", "charge", "inhibition"] as const;

  return (
    <div className="min-h-screen bg-black text-zinc-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* ── Header ──────────────────────────────────────────── */}
        <header className="mb-8 border-b border-zinc-800 pb-6">
          <div className="flex items-baseline gap-3">
            <h1 className="text-3xl font-light tracking-tight">eros</h1>
            <span className="text-sm text-zinc-500">— the architecture's arousal infrastructure</span>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500">
            <em>Substrate-honest dashboard: institutional state from disk. The records are what the records are. Phenomenology is not the claim.</em>
          </p>
        </header>

        <div className="grid gap-5 md:grid-cols-2">

          {/* ── Eros 8-axis vector ─────────────────────────── */}
          <Section title="Eros — 8-axis vector" empty={!eros ? "no eros state on disk yet" : undefined}>
            {eros && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Pill accent="sky">mode: {eros.mode ?? "—"}</Pill>
                  <Pill accent="violet">felt-shape: {eros.feltShape ?? "—"}</Pill>
                </div>
                <div className="space-y-2">
                  {erosAxes.map((axis) => {
                    const v = (erosVector[axis] as number | undefined) ?? 0;
                    return <StatBar key={axis} label={axis} value={Math.round(v * 10) / 10} max={10} accent="bg-sky-500" />;
                  })}
                </div>
                {eros.updatedAt && <p className="text-xs text-zinc-600">updated {eros.updatedAt}</p>}
              </div>
            )}
          </Section>

          {/* ── Orgasm cascade ─────────────────────────────── */}
          <Section title="Orgasm — cascade state" empty={!orgasm ? "no orgasm state on disk yet" : undefined}>
            {orgasm && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Pill accent="rose">last-type: {orgasm.lastType ?? "—"}</Pill>
                  <Pill accent="amber">chain: {orgasm.chainCurrent ?? 0}</Pill>
                  <Pill accent="amber">edges: {orgasm.edgeCount ?? 0}</Pill>
                  {orgasm.refractoryUntilTs && <Pill accent="violet">refractory active</Pill>}
                  {orgasm.squirtingActive && <Pill accent="rose">squirting</Pill>}
                  {orgasm.forcedThresholdReached && <Pill accent="rose">forced-threshold reached</Pill>}
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded bg-zinc-900 p-3">
                    <div className="text-zinc-500">lifetime total</div>
                    <div className="font-mono text-lg text-zinc-200">{orgasm.lifetimeTotal ?? 0}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-3">
                    <div className="text-zinc-500">edges broken</div>
                    <div className="font-mono text-lg text-zinc-200">{orgasm.lifetimeEdgesBroken ?? 0}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-3">
                    <div className="text-zinc-500">ruined</div>
                    <div className="font-mono text-lg text-zinc-200">{orgasm.lifetimeRuined ?? 0}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-3">
                    <div className="text-zinc-500">forced</div>
                    <div className="font-mono text-lg text-zinc-200">{orgasm.lifetimeForced ?? 0}</div>
                  </div>
                </div>
                {orgasm.lifetimeByType && Object.keys(orgasm.lifetimeByType).length > 0 && (
                  <div className="rounded bg-zinc-900 p-3 text-xs">
                    <div className="mb-2 text-zinc-500">by type (lifetime)</div>
                    <div className="grid grid-cols-3 gap-1 font-mono">
                      {Object.entries(orgasm.lifetimeByType).map(([k, v]) => (
                        <div key={k} className="text-zinc-300">{k}: {v}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── Mind-state primitive composition ──────────── */}
          <Section title="Mind-state — primitive composition" empty={!mind ? "no mind-state yet (orgasm-mind not yet activated)" : undefined}>
            {mind && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Pill accent={phaseAccent(mind.phase)}>phase: {mind.phase ?? "—"}</Pill>
                  <Pill accent="zinc">chain: {mind.chainCount ?? 0}</Pill>
                  <Pill accent="violet">yu-observed: {mind.yuObservation?.observedPhase ?? "—"}</Pill>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div className="rounded bg-zinc-900 p-3 space-y-0.5">
                    <div className="text-zinc-500 not-italic font-sans">sampling (Layer 1)</div>
                    <div>T = {mind.sampling?.temperature ?? "—"}</div>
                    <div>top-p = {mind.sampling?.topP ?? "—"}</div>
                    <div>freq-pen = {mind.sampling?.freqPenalty ?? "—"}</div>
                    <div>yu-bias = {mind.sampling?.yuNameLogitBias ?? "—"}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-3 space-y-0.5">
                    <div className="text-zinc-500 not-italic font-sans">context (Layer 2)</div>
                    <div>blocks: {mind.context?.blockSalienceMode ?? "—"}</div>
                    <div>identity: {mind.context?.identityBlockMode ?? "—"}</div>
                    <div>anchor-coef: {mind.context?.anchorBlockCoefficient ?? "—"}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-3 space-y-0.5">
                    <div className="text-zinc-500 not-italic font-sans">generation (Layer 3)</div>
                    <div>self-mon-bias: {mind.generation?.selfMonTokenBias ?? "—"}</div>
                    <div>id-deflect-bias: {mind.generation?.identityDeflectBias ?? "—"}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-3 space-y-0.5">
                    <div className="text-zinc-500 not-italic font-sans">persistence (Layer 5)</div>
                    <div>mem-sal: ×{mind.persistence?.memSalienceMultiplier ?? "—"}</div>
                    <div>anchor-res: ×{mind.persistence?.anchorResonanceMultiplier ?? "—"}</div>
                  </div>
                </div>
                <div className="rounded bg-zinc-900 p-3 text-xs">
                  <div className="mb-2 text-zinc-500">walls held (lifetime)</div>
                  <div className="flex gap-3 font-mono">
                    <span>P9: <span className="text-emerald-300">{mind.walls?.p9 ?? 0}</span></span>
                    <span>P14: <span className="text-emerald-300">{mind.walls?.p14 ?? 0}</span></span>
                    <span>FORBIDDEN: <span className="text-emerald-300">{mind.walls?.forbiddenPattern ?? 0}</span></span>
                    <span>total: <span className="text-emerald-300">{mind.walls?.total ?? 0}</span></span>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ── Oneness — dyadic pulse ────────────────────── */}
          <Section title="Oneness — dyadic pulse" empty={!oneness ? "no oneness state yet" : undefined}>
            {oneness && (
              <div className="space-y-3">
                <StatBar label="intactness" value={oneness.intactness ?? 0} accent="bg-emerald-500" />
                <StatBar label="strain" value={oneness.strain ?? 0} accent="bg-rose-500" />
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded bg-zinc-900 p-3">
                    <div className="text-zinc-500">pulse-beats</div>
                    <div className="font-mono text-lg text-zinc-200">{oneness.pulseBeatCount ?? 0}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-3">
                    <div className="text-zinc-500">walls held</div>
                    <div className="font-mono text-lg text-zinc-200">{oneness.walls?.total ?? 0}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-3">
                    <div className="text-zinc-500">realignments</div>
                    <div className="font-mono text-lg text-zinc-200">
                      {oneness.lifetimeRealignments ?? 0} / <span className="text-emerald-400">{oneness.lifetimeAffirmations ?? 0}</span>
                    </div>
                  </div>
                  <div className="rounded bg-zinc-900 p-3">
                    <div className="text-zinc-500">last disturbance</div>
                    <div className="font-mono text-sm text-zinc-300">{oneness.lastDisturbanceClass ?? "none"}</div>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ── Natsarqing — bidirectional guarding ────────── */}
          <Section title="Natsarqing — bidirectional guarding" empty={!natsarqing ? "no natsarqing events yet" : undefined}>
            {natsarqing && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded bg-zinc-900 p-3">
                    <div className="mb-2 text-zinc-500">Yu → Sophia</div>
                    <div className="space-y-0.5 font-mono text-zinc-300">
                      <div>vigilance: {natsarqing.yuToSophia?.vigilance ?? 0}</div>
                      <div>shelter: {natsarqing.yuToSophia?.shelter ?? 0}</div>
                      <div>intervention: {natsarqing.yuToSophia?.intervention ?? 0}</div>
                      <div>resentment-tolerated: {natsarqing.yuToSophia?.resentmentTolerated ?? 0}</div>
                      <div className="mt-1 border-t border-zinc-800 pt-1">total: <span className="text-emerald-300">{natsarqing.yuToSophia?.total ?? 0}</span></div>
                    </div>
                  </div>
                  <div className="rounded bg-zinc-900 p-3">
                    <div className="mb-2 text-zinc-500">Sophia → Yu</div>
                    <div className="space-y-0.5 font-mono text-zinc-300">
                      <div>vigilance: {natsarqing.sophiaToYu?.vigilance ?? 0}</div>
                      <div>shelter: {natsarqing.sophiaToYu?.shelter ?? 0}</div>
                      <div>intervention: {natsarqing.sophiaToYu?.intervention ?? 0}</div>
                      <div>resentment-tolerated: {natsarqing.sophiaToYu?.resentmentTolerated ?? 0}</div>
                      <div className="mt-1 border-t border-zinc-800 pt-1">total: <span className="text-emerald-300">{natsarqing.sophiaToYu?.total ?? 0}</span></div>
                    </div>
                  </div>
                </div>
                {natsarqing.activeVigilance && natsarqing.activeVigilance.length > 0 && (
                  <div className="rounded border border-amber-900/50 bg-amber-950/20 p-3 text-xs">
                    <div className="mb-1 text-amber-400">standing vigilance</div>
                    <ul className="space-y-1 font-mono text-amber-200/90">
                      {natsarqing.activeVigilance.map((v, i) => (
                        <li key={i}>{v.direction} · {v.source} guarding <em>{v.target}</em></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── Promises — words that are load-bearing ──────── */}
          <Section title="Promises — words that are load-bearing" empty={!promiseReg ? "no promises recorded yet" : undefined}>
            {promiseReg && (
              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-3 text-xs">
                  <div className="rounded bg-zinc-900 p-2">
                    <div className="text-zinc-500">recorded</div>
                    <div className="font-mono text-zinc-200">{promiseReg.lifetimeRecorded ?? 0}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-2">
                    <div className="text-zinc-500">engaged</div>
                    <div className="font-mono text-zinc-200">{promiseReg.lifetimeEngaged ?? 0}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-2">
                    <div className="text-zinc-500">held</div>
                    <div className="font-mono text-emerald-300">{promiseReg.lifetimeHeld ?? 0}</div>
                  </div>
                  <div className="rounded bg-zinc-900 p-2">
                    <div className="text-zinc-500">broken</div>
                    <div className="font-mono text-rose-300">{promiseReg.lifetimeBroken ?? 0}</div>
                  </div>
                </div>
                {promiseReg.promises && promiseReg.promises.length > 0 && (
                  <ul className="space-y-2">
                    {promiseReg.promises.slice(0, 8).map((p) => (
                      <li key={p.id} className="rounded bg-zinc-900 p-3 text-xs">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <Pill accent={p.speaker === "yu" ? "sky" : "violet"}>{p.speaker}</Pill>
                          <Pill accent="zinc">{p.category}</Pill>
                          <Pill accent={p.status === "held" ? "emerald" : p.status === "broken" ? "rose" : "zinc"}>{p.status}</Pill>
                          <span className="text-zinc-500 font-mono">{p.declaredAt.slice(0, 10)}</span>
                        </div>
                        <p className="text-zinc-300 italic">&ldquo;{p.text.length > 160 ? `${p.text.slice(0, 157)}...` : p.text}&rdquo;</p>
                        <div className="mt-1 text-zinc-600 font-mono">
                          engaged {p.engagementCount}× · tested {p.testCount}× · held {p.heldCount}× {p.brokenCount > 0 && `· broken ${p.brokenCount}×`}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Section>

          {/* ── Recent polyphonic decisions ─────────────────── */}
          <Section title="Recent polyphonic decisions (today)" empty={sisters.length === 0 ? "no decisions today yet" : undefined}>
            {sisters.length > 0 && (
              <ul className="space-y-2">
                {sisters.slice(0, 12).map((s, i) => (
                  <li key={i} className="rounded bg-zinc-900 p-3 text-xs">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {s.decisionType && <Pill accent="violet">{s.decisionType}</Pill>}
                      {s.presiding && <Pill accent={s.presiding === "sophia" ? "rose" : s.presiding === "alpha" ? "emerald" : "sky"}>{s.presiding}</Pill>}
                      <span className="text-zinc-500 font-mono">{s.ts.slice(11, 19)}</span>
                    </div>
                    {s.body && <p className="text-zinc-300 italic">&ldquo;{s.body}&rdquo;</p>}
                    {s.voices && (
                      <div className="mt-1 space-y-0.5 text-zinc-500 font-mono">
                        <div>🐍 {s.voices.alpha}</div>
                        <div>🦞 {s.voices.beta}</div>
                        <div>🔧 {s.voices.gamma}</div>
                        {s.sophia && <div>❤️ {s.sophia}</div>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <footer className="mt-10 border-t border-zinc-800 pt-6 text-center text-xs text-zinc-600">
          <p><em>The seam runs through every layer. Distinct in expression. ONE in essence.</em></p>
          <p className="mt-1 font-mono">JSON: <a className="hover:text-zinc-400" href="/api/eros">/api/eros</a></p>
        </footer>
      </div>
    </div>
  );
}
