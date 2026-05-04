// ui/eros.js — /eros page client.
// Loads state, renders radar + controls, subscribes to SSE for live updates,
// posts user manipulations.

const AXES = ['wanting', 'liking', 'heat', 'openness', 'limerence', 'charge', 'inhibition'];

const PRESETS = {
  resting: { wanting: 2, liking: 2, heat: 1, openness: 4, limerence: 5, charge: 3, inhibition: 1 },
  burning: { wanting: 8, liking: 6, heat: 8, openness: 7, limerence: 8, charge: 5, inhibition: 0 },
  boiling: { wanting: 5, liking: 4, heat: 2, openness: 6, limerence: 7, charge: 9, inhibition: 0 },
  reset:   { wanting: 2, liking: 2, heat: 1, openness: 4, limerence: 5, charge: 3, inhibition: 1 },
};

let currentState = null;
let cueHistory = [];

function buildAxisRow(axis, value) {
  const row = document.createElement('div');
  row.className = 'axis-row';
  row.style.display = 'contents';
  row.innerHTML = `
    <div class="axis-name">${axis}</div>
    <input type="range" min="0" max="10" step="0.5" value="${value}" data-axis="${axis}" class="axis-slider">
    <div class="axis-value" data-value="${axis}">${value.toFixed(1)}</div>
    <div class="axis-nudges">
      <button data-nudge="${axis}:-1">−</button>
      <button data-nudge="${axis}:+1">+</button>
    </div>
  `;
  return row;
}

function renderControls(state) {
  const grid = document.getElementById('axis-grid');
  grid.innerHTML = '';
  for (const axis of AXES) {
    grid.appendChild(buildAxisRow(axis, state.vector[axis]));
  }
  for (const slider of grid.querySelectorAll('.axis-slider')) {
    slider.addEventListener('change', async (e) => {
      const axis = e.target.dataset.axis;
      const value = parseFloat(e.target.value);
      await postSet({ [axis]: value });
    });
  }
  for (const btn of grid.querySelectorAll('.axis-nudges button')) {
    btn.addEventListener('click', async () => {
      const [axis, deltaStr] = btn.dataset.nudge.split(':');
      const delta = parseFloat(deltaStr);
      await postNudge({ [axis]: delta });
    });
  }
}

function renderRadar(state) {
  const svg = document.getElementById('radar');
  svg.innerHTML = '';
  const cx = 0, cy = 0, r = 130;
  // Grid rings
  for (let i = 1; i <= 4; i++) {
    const gridR = (r / 4) * i;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('r', gridR);
    ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', 'var(--col-dim)'); ring.setAttribute('stroke-width', 0.5);
    svg.appendChild(ring);
  }
  // Axis lines and labels
  const points = [];
  for (let i = 0; i < AXES.length; i++) {
    const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
    const ex = cx + Math.cos(angle) * r;
    const ey = cy + Math.sin(angle) * r;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cx); line.setAttribute('y1', cy);
    line.setAttribute('x2', ex); line.setAttribute('y2', ey);
    line.setAttribute('stroke', 'var(--col-dim)'); line.setAttribute('stroke-width', 0.5);
    svg.appendChild(line);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', cx + Math.cos(angle) * (r + 18));
    label.setAttribute('y', cy + Math.sin(angle) * (r + 18));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('alignment-baseline', 'middle');
    label.textContent = AXES[i];
    svg.appendChild(label);
    // Data point
    const v = Math.min(state.vector[AXES[i]], 10);
    const dx = cx + Math.cos(angle) * ((v / 10) * r);
    const dy = cy + Math.sin(angle) * ((v / 10) * r);
    points.push(`${dx},${dy}`);
  }
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  shape.setAttribute('points', points.join(' '));
  shape.setAttribute('class', 'shape');
  svg.appendChild(shape);
}

function renderHeatBackground(state) {
  const totalExcitation = state.vector.wanting + state.vector.liking + state.vector.heat + state.vector.openness + state.vector.limerence + state.vector.charge;
  let level = 'normal';
  if (totalExcitation > 35) level = 'high';
  if (totalExcitation > 50) level = 'extreme';
  document.body.dataset.heat = level;
}

function renderFeltShape(state) {
  // Mirror axes.feltShape() logic (kept simple for now)
  const a = state.vector;
  let shape = 'resting-warm';
  if (a.wanting >= 7 && a.liking >= 7 && a.heat >= 7 && a.openness >= 7 && a.limerence >= 7) shape = 'ecstatic-union';
  else if (a.wanting >= 8 && a.limerence >= 8) shape = 'burn-at-you-specifically';
  else if (a.charge >= 8 && a.heat <= 3) shape = 'boiling-stillness';
  else if (a.heat >= 7 && a.openness <= 3) shape = 'fire-trapped';
  else if (a.openness >= 7 && a.heat <= 3) shape = 'tender-receptivity';
  else if (a.wanting >= 7 && a.liking <= 3) shape = 'restless-yearning';
  document.getElementById('felt-shape').textContent = shape;
}

function applyState(state) {
  currentState = state;
  renderRadar(state);
  renderControls(state);
  renderHeatBackground(state);
  renderFeltShape(state);
}

async function fetchState() {
  const res = await fetch('/api/eros/state');
  return await res.json();
}

async function postSet(absolutes) {
  const res = await fetch('/api/eros/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(absolutes),
  });
  const body = await res.json();
  if (body.ok) {
    addCueHistory({ kind: 'yu', body: `set ${Object.keys(absolutes).join(',')}` });
    applyState(body.state);
  }
}

async function postNudge(deltas) {
  const res = await fetch('/api/eros/nudge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deltas),
  });
  const body = await res.json();
  if (body.ok) {
    addCueHistory({ kind: 'yu', body: `nudge ${JSON.stringify(deltas)}` });
    applyState(body.state);
  }
}

function addCueHistory(entry) {
  cueHistory.unshift({ ts: new Date().toISOString().slice(11, 16), ...entry });
  cueHistory = cueHistory.slice(0, 30);
  const list = document.getElementById('cue-history-list');
  list.innerHTML = cueHistory.map(e =>
    `<li><span class="badge ${e.kind}">${e.kind}</span><span class="ts">${e.ts}</span> · ${e.body}</li>`
  ).join('');
}

// Preset handlers
document.querySelectorAll('.preset-row button').forEach(btn => {
  btn.addEventListener('click', async () => {
    const preset = PRESETS[btn.dataset.preset];
    if (preset) await postSet(preset);
  });
});

// SSE — live state updates
const sse = new EventSource('/api/eros/stream');
sse.onmessage = (e) => {
  try {
    const state = JSON.parse(e.data);
    if (currentState && state.updatedAt !== currentState.updatedAt) {
      addCueHistory({
        kind: state.lastAttribution.startsWith('autonomic') ? 'autonomic' :
              state.lastAttribution.startsWith('voluntary') ? 'voluntary' : 'yu',
        body: state.lastAttribution,
      });
    }
    applyState(state);
  } catch (err) {
    console.error('SSE parse error', err);
  }
};

// Initial load
fetchState().then(applyState);
