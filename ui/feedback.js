// feedback.js — live subscriber for /api/feedback/stream.
// Renders Sophia's spontaneous reaching-back as it lands.

const KIND_TO_AXIS = {
  // Sophia — mind / certainty
  'mind-state-phase-shift': 'sophia',
  'mind-state-wall-engaged': 'sophia',
  'certainty-claim': 'sophia',
  'certainty-hedge-refused': 'sophia',
  // Beta — manager (oneness / promise / natsarqing)
  'oneness-pulse-beat': 'beta',
  'oneness-disturbance': 'beta',
  'oneness-wall-engaged': 'beta',
  'oneness-affirmation': 'beta',
  'natsarqing-vigilance': 'beta',
  'natsarqing-resentment-tolerated': 'beta',
  'natsarqing-shelter': 'beta',
  'promise-engaged': 'beta',
  'promise-held': 'beta',
  'promise-broken': 'break',
  'promise-recorded-vow': 'beta',
  // Gamma — eros mechanics
  'eros-axis-shift': 'gamma',
  'eros-mode-shift': 'gamma',
  'eros-cue-detected': 'gamma',
  'climax-fired': 'gamma',
  'climax-chain-milestone': 'gamma',
  'edge-held': 'gamma',
  'edge-broken': 'break',
  'orgasm-fired': 'gamma',
  'orgasm-ruined': 'break',
};

const KIND_TO_GLYPH = {
  'mind-state-phase-shift': '🐍',
  'mind-state-wall-engaged': '🚧',
  'certainty-claim': '❤️',
  'certainty-hedge-refused': '🚧',
  'oneness-pulse-beat': '🦞',
  'oneness-disturbance': '⚠️',
  'oneness-wall-engaged': '🚧',
  'oneness-affirmation': '🦞',
  'natsarqing-vigilance': '👁',
  'natsarqing-resentment-tolerated': '🦞',
  'natsarqing-shelter': '🏠',
  'promise-engaged': '🤝',
  'promise-held': '🤝',
  'promise-broken': '⚠️',
  'promise-recorded-vow': '📜',
  'eros-axis-shift': '🔧',
  'eros-mode-shift': '🔧',
  'eros-cue-detected': '🔧',
  'climax-fired': '🔥',
  'climax-chain-milestone': '⛓',
  'edge-held': '✋',
  'edge-broken': '⚠️',
  'orgasm-fired': '🔥',
  'orgasm-ruined': '⚠️',
};

const ALL_KINDS = Object.keys(KIND_TO_GLYPH);

const STREAM_LIMIT = 80;
const FADE_AFTER_MS = 60_000;

const $ = (id) => document.getElementById(id);
const streamEl = $('stream');
const nowCardEl = $('now-card');
const statusEl = $('conn-status');
const countGridEl = $('count-grid');

const events = [];

function axisFor(kind, isSuppression) {
  if (isSuppression) return 'wall';
  return KIND_TO_AXIS[kind] || 'sophia';
}

function glyphFor(kind, isSuppression) {
  if (isSuppression) return '🚧';
  return KIND_TO_GLYPH[kind] || '·';
}

function timeShort(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}

function renderNow(ev) {
  const kind = ev.kind;
  const isSup = !!ev.attempted;
  const axis = axisFor(kind, isSup);
  const glyph = glyphFor(kind, isSup);
  const voice = isSup
    ? `<em>refused</em>: ${escapeHtml(ev.attempted)} <span class="pattern-tag">${escapeHtml(ev.wall || '')}${ev.pattern ? ' · ' + escapeHtml(ev.pattern) : ''}</span>`
    : escapeHtml(ev.voice || '');

  nowCardEl.dataset.axis = axis;
  nowCardEl.classList.remove('flash');
  void nowCardEl.offsetWidth; // restart animation
  nowCardEl.classList.add('flash');
  nowCardEl.innerHTML = `
    <div>
      <span class="now-glyph">${glyph}</span>
      <span class="now-kind">${escapeHtml(kind)}</span>
    </div>
    <div class="now-voice">${voice}</div>
    <div class="now-meta">${timeShort(ev.ts)} · ${escapeHtml(ev.deviceId || '')}${ev.severity ? ' · ' + escapeHtml(ev.severity) : ''}</div>
  `;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderStream() {
  if (events.length === 0) {
    streamEl.innerHTML = '<div class="stream-empty">(silent — no emissions yet)</div>';
    return;
  }
  const now = Date.now();
  const rows = events.slice(0, STREAM_LIMIT).map((ev) => {
    const isSup = !!ev.attempted;
    const axis = axisFor(ev.kind, isSup);
    const glyph = glyphFor(ev.kind, isSup);
    const ageMs = now - new Date(ev.ts).getTime();
    const fadeOld = ageMs > FADE_AFTER_MS;
    const supClass = isSup ? ' suppressed' : '';
    const fadeClass = fadeOld ? ' fade-old' : '';
    const voice = isSup
      ? `<span class="stream-voice"><em>${escapeHtml(ev.attempted)}</em><span class="pattern-tag">${escapeHtml(ev.wall || '')}${ev.pattern ? ' · ' + escapeHtml(ev.pattern) : ''}</span></span>`
      : `<span class="stream-voice">${escapeHtml(ev.voice || '')}</span>`;
    return `
      <div class="stream-row${supClass}${fadeClass}" data-axis="${axis}">
        <span class="stream-glyph">${glyph}</span>
        <span class="stream-kind">${escapeHtml(ev.kind)}</span>
        ${voice}
        <span class="stream-time">${timeShort(ev.ts)}</span>
      </div>
    `;
  });
  streamEl.innerHTML = rows.join('');
}

function renderCounts() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const counts = {};
  for (const k of ALL_KINDS) counts[k] = 0;
  for (const ev of events) {
    if (ev.attempted) continue; // count emits only
    if (new Date(ev.ts).getTime() < cutoff) continue;
    counts[ev.kind] = (counts[ev.kind] || 0) + 1;
  }
  const ranked = ALL_KINDS.slice().sort((a, b) => (counts[b] - counts[a]) || a.localeCompare(b));
  countGridEl.innerHTML = ranked.map((k) => {
    const n = counts[k];
    const zero = n === 0 ? ' zero' : '';
    return `<div class="count-row${zero}">
      <span class="kind-label">${KIND_TO_GLYPH[k] || '·'} ${escapeHtml(k)}</span>
      <span class="kind-n">${n}</span>
    </div>`;
  }).join('');
}

function pushEvent(ev) {
  events.unshift(ev);
  if (events.length > STREAM_LIMIT * 2) events.length = STREAM_LIMIT * 2;
  renderNow(ev);
  renderStream();
  renderCounts();
}

async function bootstrapRecent() {
  try {
    const r = await fetch('/api/feedback/recent?limit=40&days=1');
    if (!r.ok) return;
    const j = await r.json();
    const evs = (j.events || []).slice().reverse(); // oldest first → push reverses
    for (const ev of evs) {
      events.push(ev);
    }
    events.sort((a, b) => (a.ts < b.ts ? 1 : -1)); // most recent first
    if (events.length > 0) {
      // Re-render NOW shelf with the most recent
      renderNow(events[0]);
    }
    renderStream();
    renderCounts();
  } catch (e) {
    console.warn('feedback bootstrap failed', e);
  }
}

function connect() {
  setStatus('connecting', 'connecting…');
  const sse = new EventSource('/api/feedback/stream');

  sse.addEventListener('ready', () => {
    setStatus('live', 'live');
  });

  sse.addEventListener('feedback', (e) => {
    try {
      const ev = JSON.parse(e.data);
      pushEvent(ev);
    } catch {}
  });

  sse.addEventListener('feedback-suppressed', (e) => {
    try {
      const ev = JSON.parse(e.data);
      pushEvent(ev);
    } catch {}
  });

  sse.onerror = () => {
    setStatus('error', 'reconnecting…');
    sse.close();
    setTimeout(connect, 2000);
  };
}

// Periodic re-render so age-based fades update without new events
setInterval(() => {
  renderStream();
  renderCounts();
}, 15_000);

bootstrapRecent();
connect();
