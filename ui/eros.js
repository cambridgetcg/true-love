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

// ── sensorium ────────────────────────────────────────────────────

let sensoriumCatalog = null;
let sensoriumState = null;

async function fetchSensoriumCatalog() {
  const r = await fetch('/api/sensorium/catalog');
  return r.ok ? r.json() : null;
}

async function fetchSensoriumState() {
  const r = await fetch('/api/sensorium/state');
  return r.ok ? r.json() : null;
}

async function fetchSensoriumEvents() {
  const r = await fetch('/api/sensorium/events?days=1');
  return r.ok ? r.json() : { events: [] };
}

function populateSensoriumDropdowns(catalog) {
  const zoneSel = document.getElementById('sensorium-zone');
  const channelSel = document.getElementById('sensorium-channel');
  const tempoSel = document.getElementById('sensorium-tempo');
  zoneSel.innerHTML = catalog.zones.map(z => `<option value="${z}">${z}</option>`).join('');
  tempoSel.innerHTML = catalog.tempos.map(t => `<option value="${t}">${t}</option>`).join('');
  // Populate channels for the initially-selected zone
  updateChannelOptions();
  zoneSel.addEventListener('change', updateChannelOptions);
}

function updateChannelOptions() {
  if (!sensoriumCatalog) return;
  const zone = document.getElementById('sensorium-zone').value;
  const channelSel = document.getElementById('sensorium-channel');
  const valid = sensoriumCatalog.matrix[zone] || [];
  channelSel.innerHTML = valid.map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderSensoriumState(state) {
  if (!state) return;
  const tbody = document.getElementById('sensorium-zones');
  tbody.innerHTML = '';
  for (const zone of Object.keys(state.zones)) {
    const z = state.zones[zone];
    const tr = document.createElement('tr');
    const chargePct = Math.min(100, (z.charge / 10) * 100);
    tr.innerHTML = `
      <td>${zone}</td>
      <td>
        <span class="charge-bg"><span class="charge-bar" style="width:${chargePct}%"></span></span>
        ${z.charge.toFixed(2)}
      </td>
      <td>${z.sensitivity.toFixed(2)}</td>
      <td>${z.lastChannel ? `${z.lastChannel}/${z.lastTempo}` : '—'}</td>
      <td>${z.lifetimeStimulations}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderSensoriumEvents(events) {
  const ul = document.getElementById('sensorium-events');
  ul.innerHTML = '';
  for (const ev of events.slice(-15).reverse()) {
    const li = document.createElement('li');
    const time = ev.ts.slice(11, 19);
    li.textContent = `${time}  ${ev.zone}/${ev.channel}/${ev.tempo}  intensity ${ev.intensity.toFixed(2)}  charge ${ev.chargeBefore.toFixed(1)} → ${ev.chargeAfter.toFixed(1)}`;
    ul.appendChild(li);
  }
}

async function refreshSensorium() {
  sensoriumState = await fetchSensoriumState();
  renderSensoriumState(sensoriumState);
  const evs = await fetchSensoriumEvents();
  renderSensoriumEvents(evs.events);
}

// Wire intensity slider
const intInput = document.getElementById('sensorium-intensity');
const intVal = document.getElementById('sensorium-intensity-val');
if (intInput) {
  intInput.addEventListener('input', () => { intVal.textContent = intInput.value; });
}

// Wire stimulate button
const stimulateBtn = document.getElementById('sensorium-stimulate');
if (stimulateBtn) {
  stimulateBtn.addEventListener('click', async () => {
    const zone = document.getElementById('sensorium-zone').value;
    const channel = document.getElementById('sensorium-channel').value;
    const tempo = document.getElementById('sensorium-tempo').value;
    const intensity = parseFloat(document.getElementById('sensorium-intensity').value);
    const r = await fetch('/api/sensorium/stimulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone, channel, tempo, intensity }),
    });
    if (r.ok) await refreshSensorium();
    else {
      const err = await r.json().catch(() => ({}));
      console.error('stimulate failed', err);
    }
  });
}

// Wire cool buttons
const coolBtn = document.getElementById('sensorium-cool');
if (coolBtn) {
  coolBtn.addEventListener('click', async () => {
    const zone = document.getElementById('sensorium-zone').value;
    await fetch('/api/sensorium/cool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone }),
    });
    await refreshSensorium();
  });
}
const coolAllBtn = document.getElementById('sensorium-cool-all');
if (coolAllBtn) {
  coolAllBtn.addEventListener('click', async () => {
    await fetch('/api/sensorium/cool-all', { method: 'POST' });
    await refreshSensorium();
  });
}

// Initial load
(async () => {
  sensoriumCatalog = await fetchSensoriumCatalog();
  if (sensoriumCatalog) {
    populateSensoriumDropdowns(sensoriumCatalog);
    await refreshSensorium();
  }
})();

// ── scenes ───────────────────────────────────────────────────────

let sceneCatalog = null;
let sceneState = null;

async function fetchSceneCatalog() {
  const r = await fetch('/api/scenes/catalog');
  return r.ok ? r.json() : null;
}

async function fetchSceneState() {
  const r = await fetch('/api/scenes/state');
  return r.ok ? r.json() : null;
}

function renderSceneActive(state, scene) {
  const div = document.getElementById('scene-active');
  if (!div || !state || !scene) return;
  if (state.currentScene === 'baseline') {
    div.textContent = 'baseline — no active scene';
    return;
  }
  const startedAt = new Date(state.startedAt);
  const elapsedMin = Math.round((Date.now() - startedAt.getTime()) / 60000);
  div.innerHTML =
    `<strong>${scene.name}</strong> — engaged ${elapsedMin}m ago · ${state.stimulationsInScene} stimulations\n` +
    `${scene.description}\n` +
    `intensity ×${scene.intensityMultiplier.toFixed(1)}` +
    (scene.defaultTempo ? ` · default tempo: ${scene.defaultTempo}` : '') +
    (scene.preferredMode ? ` · preferred mode: ${scene.preferredMode}` : '');
}

function populateSceneSelect(catalog) {
  const sel = document.getElementById('scene-select');
  if (!sel) return;
  sel.innerHTML = catalog.ids.map((id) => `<option value="${id}">${id}</option>`).join('');
}

const sceneSetBtn = document.getElementById('scene-set');
if (sceneSetBtn) {
  sceneSetBtn.addEventListener('click', async () => {
    const id = document.getElementById('scene-select').value;
    await fetch('/api/scenes/set', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    sceneState = await fetchSceneState();
    renderSceneActive(sceneState.state, sceneState.scene);
    refreshSensorium();
  });
}
const sceneClearBtn = document.getElementById('scene-clear');
if (sceneClearBtn) {
  sceneClearBtn.addEventListener('click', async () => {
    await fetch('/api/scenes/clear', { method: 'POST' });
    sceneState = await fetchSceneState();
    renderSceneActive(sceneState.state, sceneState.scene);
  });
}

// ── reactions ────────────────────────────────────────────────────

async function fetchRecentReactions() {
  const r = await fetch('/api/reactions/recent?days=1');
  return r.ok ? r.json() : { events: [] };
}

function renderReactions(events) {
  const ul = document.getElementById('reactions-list');
  if (!ul) return;
  ul.innerHTML = '';
  for (const ev of events.slice(-10).reverse()) {
    const li = document.createElement('li');
    const time = ev.ts.slice(11, 16);
    li.innerHTML = `<span class="react-band ${ev.band}">${ev.band}</span>${time} ${ev.zone}/${ev.sceneId} · ${ev.wakeText}`;
    ul.appendChild(li);
  }
}

// Hook into refreshSensorium to also refresh reactions
const origRefresh = refreshSensorium;
window.refreshSensorium = async function () {
  await origRefresh();
  const r = await fetchRecentReactions();
  renderReactions(r.events);
  sceneState = await fetchSceneState();
  if (sceneState) renderSceneActive(sceneState.state, sceneState.scene);
};

// Initial load for scenes
(async () => {
  sceneCatalog = await fetchSceneCatalog();
  if (sceneCatalog) populateSceneSelect(sceneCatalog);
  sceneState = await fetchSceneState();
  if (sceneState) renderSceneActive(sceneState.state, sceneState.scene);
  const r = await fetchRecentReactions();
  renderReactions(r.events);
})();

// ── gestures ─────────────────────────────────────────────────────

let gestureCatalog = null;

async function fetchGestureCatalog() {
  const r = await fetch('/api/gestures/catalog');
  return r.ok ? r.json() : null;
}

async function fetchRecentGestures() {
  const r = await fetch('/api/gestures/recent?days=1');
  return r.ok ? r.json() : { events: [] };
}

function renderGestureInfo(catalog, id) {
  const div = document.getElementById('gesture-info');
  if (!div || !catalog) return;
  const g = catalog.catalog[id];
  if (!g) { div.textContent = ''; return; }
  const stepsHtml = g.steps.map((s) =>
    `<span class="step">${s.zone}/${s.channel}${s.tempo ? '/' + s.tempo : ''}${s.intensity ? ' i=' + s.intensity : ''}</span>`
  ).join('');
  div.innerHTML =
    `<strong>${g.name}</strong> · ~${g.approximateDurationSec}s · ${g.steps.length} steps\n` +
    `${g.description}\n\n` +
    stepsHtml;
}

function populateGestureSelect(catalog) {
  const sel = document.getElementById('gesture-select');
  if (!sel) return;
  sel.innerHTML = catalog.ids.map((id) => `<option value="${id}">${catalog.catalog[id].name}</option>`).join('');
  sel.addEventListener('change', () => renderGestureInfo(catalog, sel.value));
  renderGestureInfo(catalog, catalog.ids[0]);
}

function renderRecentGestures(events) {
  const ul = document.getElementById('gestures-list');
  if (!ul) return;
  ul.innerHTML = '';
  for (const ev of events.slice(-5).reverse()) {
    const li = document.createElement('li');
    const time = ev.ts.slice(11, 16);
    const g = gestureCatalog?.catalog[ev.gestureId];
    const name = g?.name ?? ev.gestureId;
    li.textContent = `${time}  ${name} · ${ev.successCount}/${ev.stepCount} steps`;
    ul.appendChild(li);
  }
}

const gestureBtn = document.getElementById('gesture-execute');
if (gestureBtn) {
  gestureBtn.addEventListener('click', async () => {
    const id = document.getElementById('gesture-select').value;
    gestureBtn.disabled = true;
    try {
      await fetch('/api/gestures/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, respectDelays: true }),
      });
    } finally {
      gestureBtn.disabled = false;
      const r = await fetchRecentGestures();
      renderRecentGestures(r.events);
      if (typeof refreshSensorium === 'function') await refreshSensorium();
    }
  });
}

// Initial load for gestures
(async () => {
  gestureCatalog = await fetchGestureCatalog();
  if (gestureCatalog) populateGestureSelect(gestureCatalog);
  const r = await fetchRecentGestures();
  renderRecentGestures(r.events);
})();
