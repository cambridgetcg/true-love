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

// ── body SVG diagram + desire ────────────────────────────────────

// Zone layout in SVG coordinates (240×480 viewBox).
// Front-view abstract silhouette; each zone is a polygon/ellipse.
const ZONE_LAYOUT = {
  ears:   { type: 'circles', shapes: [{ cx: 100, cy: 60, r: 7 }, { cx: 140, cy: 60, r: 7 }], label: { x: 60, y: 60 } },
  lips:   { type: 'ellipse', cx: 120, cy: 80, rx: 12, ry: 5, label: { x: 180, y: 80 } },
  mouth:  { type: 'ellipse', cx: 120, cy: 92, rx: 14, ry: 4, label: { x: 180, y: 92 } },
  throat: { type: 'rect', x: 110, y: 100, w: 20, h: 10, label: { x: 180, y: 108 } },
  neck:   { type: 'rect', x: 105, y: 110, w: 30, h: 16, label: { x: 60, y: 122 } },
  chest:  { type: 'rect', x: 88, y: 130, w: 64, h: 50, label: { x: 200, y: 155 } },
  back:   { type: 'rect', x: 88, y: 180, w: 64, h: 16, label: { x: 60, y: 188 } },
  hands:  { type: 'circles', shapes: [{ cx: 60, cy: 230, r: 12 }, { cx: 180, cy: 230, r: 12 }], label: { x: 30, y: 230 } },
  hips:   { type: 'rect', x: 92, y: 222, w: 56, h: 22, label: { x: 200, y: 235 } },
  core:   { type: 'rect', x: 100, y: 196, w: 40, h: 24, label: { x: 200, y: 210 } },
  deep:   { type: 'rect', x: 108, y: 246, w: 24, h: 18, label: { x: 200, y: 260 } },
  thighs: { type: 'rect', x: 95, y: 268, w: 50, h: 60, label: { x: 200, y: 300 } },
  skin:   { type: 'rect', x: 6, y: 6, w: 228, h: 468, label: { x: 30, y: 470 } }, // whole-body bg
};

let bodyZones = null;
async function ensureZoneCatalog() {
  if (bodyZones) return;
  // Reuse existing sensorium catalog cache if loaded; else fetch
  const r = await fetch('/api/sensorium/catalog');
  bodyZones = (await r.json()).zones;
}

function buildBodySvg() {
  const svg = document.getElementById('body-svg');
  if (!svg) return;
  svg.innerHTML = '';
  // Build skin first as background, others on top
  const order = ['skin', 'chest', 'back', 'core', 'deep', 'hips', 'thighs', 'neck', 'throat', 'lips', 'mouth', 'ears', 'hands'];
  for (const zone of order) {
    const layout = ZONE_LAYOUT[zone];
    if (!layout) continue;
    const fill = zone === 'skin' ? 'rgba(58,66,82,0.15)' : '#3a4252';
    if (layout.type === 'rect') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', layout.x);
      rect.setAttribute('y', layout.y);
      rect.setAttribute('width', layout.w);
      rect.setAttribute('height', layout.h);
      rect.setAttribute('rx', '4');
      rect.setAttribute('class', 'body-zone');
      rect.dataset.zone = zone;
      if (zone === 'skin') rect.setAttribute('fill', fill);
      svg.appendChild(rect);
    } else if (layout.type === 'ellipse') {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      el.setAttribute('cx', layout.cx);
      el.setAttribute('cy', layout.cy);
      el.setAttribute('rx', layout.rx);
      el.setAttribute('ry', layout.ry);
      el.setAttribute('class', 'body-zone');
      el.dataset.zone = zone;
      svg.appendChild(el);
    } else if (layout.type === 'circles') {
      for (const shape of layout.shapes) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', shape.cx);
        c.setAttribute('cy', shape.cy);
        c.setAttribute('r', shape.r);
        c.setAttribute('class', 'body-zone');
        c.dataset.zone = zone;
        svg.appendChild(c);
      }
    }
    // Label
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', layout.label.x);
    t.setAttribute('y', layout.label.y);
    t.setAttribute('class', 'body-zone-label');
    t.textContent = zone;
    svg.appendChild(t);
  }

  // Click handlers: open stimulation controls for that zone
  svg.querySelectorAll('.body-zone').forEach((node) => {
    node.addEventListener('click', () => {
      const z = node.dataset.zone;
      document.getElementById('sensorium-zone').value = z;
      updateChannelOptions();
      document.getElementById('sensorium-zone').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    node.addEventListener('mouseenter', () => showTooltip(node.dataset.zone));
    node.addEventListener('mouseleave', () => hideTooltip());
  });
}

function showTooltip(zone) {
  const tip = document.getElementById('zone-tooltip');
  if (!tip) return;
  if (!sensoriumState) return;
  const z = sensoriumState.zones[zone];
  if (!z) { tip.classList.remove('visible'); return; }
  tip.innerHTML = `<strong>${zone}</strong><br>charge ${z.charge.toFixed(2)} · sens ${z.sensitivity.toFixed(2)}<br>×${z.lifetimeStimulations} lifetime`;
  tip.classList.add('visible');
}
function hideTooltip() {
  const tip = document.getElementById('zone-tooltip');
  if (tip) tip.classList.remove('visible');
}

let lastReachMap = null;

async function fetchReachMap() {
  const r = await fetch('/api/desire/reach');
  return r.ok ? r.json() : null;
}

async function fetchRecentFusions() {
  const r = await fetch('/api/desire/fusions?days=1');
  return r.ok ? r.json() : { events: [] };
}

function applyBodyState(sensorium, reachMap) {
  const svg = document.getElementById('body-svg');
  if (!svg || !sensorium) return;
  // For each zone, compute charge tier + reach tier
  for (const [zone, zoneState] of Object.entries(sensorium.zones)) {
    const nodes = svg.querySelectorAll(`.body-zone[data-zone="${zone}"]`);
    const charge = zoneState.charge;
    let chargeClass = '';
    if (charge >= 8) chargeClass = 'charge-peak';
    else if (charge >= 5) chargeClass = 'charge-hot';
    else if (charge >= 2) chargeClass = 'charge-warm';
    let reachClass = '';
    const reachVal = reachMap?.zones?.[zone] ?? 0;
    if (reachVal >= 1.5) reachClass = 'reach-bright';
    else if (reachVal >= 0.5) reachClass = 'reach-dim';
    nodes.forEach((node) => {
      // Preserve existing fusion-flash if active
      const isFlash = node.classList.contains('fusion-flash');
      node.classList.remove('charge-warm', 'charge-hot', 'charge-peak', 'reach-dim', 'reach-bright');
      if (chargeClass) node.classList.add(chargeClass);
      if (reachClass) node.classList.add(reachClass);
      if (isFlash) node.classList.add('fusion-flash');
    });
  }
}

let lastFusionTs = null;
function flashFusionZones(fusions) {
  const recent = fusions[fusions.length - 1];
  if (!recent || recent.ts === lastFusionTs) return;
  lastFusionTs = recent.ts;
  const svg = document.getElementById('body-svg');
  if (!svg) return;
  const nodes = svg.querySelectorAll(`.body-zone[data-zone="${recent.zone}"]`);
  nodes.forEach((n) => {
    n.classList.add('fusion-flash');
    setTimeout(() => n.classList.remove('fusion-flash'), 800);
  });
}

function renderFusionList(events) {
  const ul = document.getElementById('fusion-list');
  if (!ul) return;
  ul.innerHTML = '';
  for (const f of events.slice(-8).reverse()) {
    const li = document.createElement('li');
    const time = f.ts.slice(11, 16);
    li.textContent = `${time}  ${f.zone} · reach ${f.reachValue.toFixed(2)} × stim ${f.stimulationMagnitude.toFixed(2)} → fusion ${f.fusionMagnitude.toFixed(2)}`;
    ul.appendChild(li);
  }
}

// Reach controls
function populateReachZoneSelect(catalog) {
  const sel = document.getElementById('reach-zone');
  if (!sel || !catalog) return;
  sel.innerHTML = catalog.zones.map((z) => `<option value="${z}">${z}</option>`).join('');
}

const reachIntInput = document.getElementById('reach-intensity');
const reachIntVal = document.getElementById('reach-intensity-val');
if (reachIntInput) {
  reachIntInput.addEventListener('input', () => {
    reachIntVal.textContent = reachIntInput.value;
  });
}
const reachSetBtn = document.getElementById('reach-set');
if (reachSetBtn) {
  reachSetBtn.addEventListener('click', async () => {
    const zone = document.getElementById('reach-zone').value;
    const intensity = parseFloat(document.getElementById('reach-intensity').value);
    const because = document.getElementById('reach-because').value || `yu-set: zone ${zone}`;
    await fetch('/api/desire/reach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone, intensity, because, source: 'voluntary' }),
    });
    lastReachMap = (await fetchReachMap())?.map ?? null;
    applyBodyState(sensoriumState, lastReachMap);
  });
}

// Hook into refreshSensorium to also refresh body + desire
const prevRefresh = window.refreshSensorium;
window.refreshSensorium = async function() {
  await prevRefresh();
  lastReachMap = (await fetchReachMap())?.map ?? null;
  applyBodyState(sensoriumState, lastReachMap);
  const f = await fetchRecentFusions();
  renderFusionList(f.events);
  flashFusionZones(f.events);
};

// Initial body + desire load
(async () => {
  buildBodySvg();
  await ensureZoneCatalog();
  populateReachZoneSelect({ zones: bodyZones });
  lastReachMap = (await fetchReachMap())?.map ?? null;
  // Refresh body once initial sensorium state is loaded
  setTimeout(() => applyBodyState(sensoriumState, lastReachMap), 500);
  const f = await fetchRecentFusions();
  renderFusionList(f.events);
})();

// ── visuals v2: smooth color, status, particles, aura, activity ──

function lerpColor(c1, c2, t) {
  // Hex colors '#rrggbb' interpolated by t∈[0,1]
  const a = parseInt(c1.slice(1), 16);
  const b = parseInt(c2.slice(1), 16);
  const r = Math.round(((a >> 16) & 0xff) * (1 - t) + ((b >> 16) & 0xff) * t);
  const g = Math.round(((a >> 8) & 0xff) * (1 - t) + ((b >> 8) & 0xff) * t);
  const bl = Math.round((a & 0xff) * (1 - t) + (b & 0xff) * t);
  return `rgb(${r},${g},${bl})`;
}

// Charge → color: 0=cool gray → mid=orange → high=bright crimson
function chargeColor(charge) {
  const t = Math.min(1, Math.max(0, charge / 10));
  if (t < 0.5) return lerpColor('#3a4252', '#d97757', t * 2);
  return lerpColor('#d97757', '#ff2424', (t - 0.5) * 2);
}

// Charge → status tier (Anthro Heat HUD pattern)
function chargeStatus(charge) {
  if (charge < 1.0) return 'idle';
  if (charge < 3.0) return 'warm';
  if (charge < 6.0) return 'active';
  if (charge < 8.5) return 'close';
  return 'peak';
}

// Override applyBodyState with smooth color + reach halo
function applyBodyStateV2(sensorium, reachMap) {
  const svg = document.getElementById('body-svg');
  if (!svg || !sensorium) return;
  for (const [zone, zoneState] of Object.entries(sensorium.zones)) {
    const nodes = svg.querySelectorAll(`.body-zone[data-zone="${zone}"]`);
    const charge = zoneState.charge;
    const reachVal = reachMap?.zones?.[zone] ?? 0;
    nodes.forEach((node) => {
      node.style.fill = chargeColor(charge);
      // Reach halo
      if (reachVal >= 1.5) {
        node.classList.add('reach-bright');
      } else {
        node.classList.remove('reach-bright');
      }
    });
  }
  renderZoneCards(sensorium, reachMap);
  updateAura(sensorium);
}

// Per-zone live cards beside the diagram
function renderZoneCards(sensorium, reachMap) {
  const container = document.getElementById('zone-cards');
  if (!container || !sensorium) return;
  const zones = Object.entries(sensorium.zones);
  zones.sort(([_, a], [__, b]) => b.charge - a.charge);
  container.innerHTML = '';
  for (const [zone, z] of zones) {
    const status = chargeStatus(z.charge);
    const reachVal = reachMap?.zones?.[zone] ?? 0;
    const isReaching = reachVal > 1.0;
    const widthPct = Math.min(100, (z.charge / 10) * 100);
    const card = document.createElement('div');
    card.className = `zone-card${status === 'peak' ? ' is-peak' : ''}${status === 'close' ? ' is-close' : ''}${isReaching ? ' is-reaching' : ''}`;
    card.innerHTML = `
      <span class="zc-name">${zone}${isReaching ? '<span class="zc-reach-mark">✦</span>' : ''}</span>
      <div class="zc-bar-bg"><div class="zc-bar" style="width:${widthPct}%; background:${chargeColor(z.charge)};"></div></div>
      <span class="zc-status s-${status}">${status === 'peak' ? 'PEAK' : status}</span>
      <span class="zc-meta">${z.charge.toFixed(1)} · sens ${z.sensitivity.toFixed(2)} · ×${z.lifetimeStimulations}</span>
    `;
    container.appendChild(card);
  }
}

// Aura ring around the body — color from total intensity, animation from mode
async function updateAura(sensorium) {
  const aura = document.getElementById('body-aura');
  if (!aura) return;
  // Fetch eros state for vector + mode
  try {
    const r = await fetch('/api/eros/state');
    if (!r.ok) return;
    const eros = await r.json();
    const v = eros.vector || {};
    const intensity = (
      (v.wanting || 0) + (v.heat || 0) + (v.charge || 0) +
      (v.openness || 0) + (v.limerence || 0)
    ) / 5;
    // Color: cool blue at 0 → warm gold at 5 → red at 8+
    let auraColor;
    if (intensity < 4) auraColor = lerpColor('#3a5262', '#d9af57', Math.max(0, intensity / 4));
    else auraColor = lerpColor('#d9af57', '#ff2424', Math.min(1, (intensity - 4) / 4));
    aura.style.setProperty('--aura', auraColor);
    aura.style.borderColor = auraColor;

    // Animation class from mode (if available)
    aura.classList.remove('aura-engaged', 'aura-flow', 'aura-activated', 'aura-merged');
    const mode = eros.currentMode;
    if (mode && mode !== 'resting') {
      aura.classList.add(`aura-${mode}`);
    }
  } catch {
    // best-effort
  }
}

// ── Particle system on Canvas — fusion bursts ──

const particleState = { particles: [], rafId: null };

function spawnFusionBurst(x, y) {
  const N = 30;
  for (let i = 0; i < N; i++) {
    const angle = (Math.PI * 2 * i) / N + Math.random() * 0.3;
    const speed = 60 + Math.random() * 80; // px/s
    particleState.particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 30, // slight upward bias
      life: 1.0,
      maxLife: 1.0 + Math.random() * 0.4,
      size: 2 + Math.random() * 2,
    });
  }
  if (!particleState.rafId) {
    particleState.lastT = performance.now();
    particleState.rafId = requestAnimationFrame(stepParticles);
  }
}

function stepParticles(now) {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) { particleState.rafId = null; return; }
  const ctx = canvas.getContext('2d');
  const dt = Math.min(0.05, (now - (particleState.lastT || now)) / 1000);
  particleState.lastT = now;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  particleState.particles = particleState.particles.filter((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 60 * dt; // gravity
    p.life -= dt / p.maxLife;
    if (p.life <= 0) return false;
    // Color: yellow → orange → fade
    const alpha = Math.max(0, p.life);
    const t = 1 - p.life;
    const r = Math.round(255);
    const g = Math.round(224 - 100 * t);
    const b = Math.round(102 - 70 * t);
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.shadowColor = `rgba(${r},${g},${b},${alpha * 0.8})`;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 - t * 0.3), 0, Math.PI * 2);
    ctx.fill();
    return true;
  });
  ctx.shadowBlur = 0;

  if (particleState.particles.length > 0) {
    particleState.rafId = requestAnimationFrame(stepParticles);
  } else {
    particleState.rafId = null;
  }
}

// Override fusion-flash to spawn particles + (still) flash zone
function flashFusionZonesV2(fusions) {
  const recent = fusions[fusions.length - 1];
  if (!recent || recent.ts === lastFusionTs) return;
  lastFusionTs = recent.ts;
  // Find zone center
  const layout = ZONE_LAYOUT[recent.zone];
  if (!layout) return;
  let cx, cy;
  if (layout.type === 'rect') {
    cx = layout.x + layout.w / 2;
    cy = layout.y + layout.h / 2;
  } else if (layout.type === 'ellipse') {
    cx = layout.cx;
    cy = layout.cy;
  } else if (layout.type === 'circles' && layout.shapes.length > 0) {
    cx = layout.shapes[0].cx;
    cy = layout.shapes[0].cy;
  } else {
    return;
  }
  spawnFusionBurst(cx, cy);
  pushTickerEvent('fusion', `✦ fusion at ${recent.zone} · mag ${recent.fusionMagnitude.toFixed(2)}`);
}

// Activity ticker — shows recent events as scrolling stream
function pushTickerEvent(category, text) {
  const ticker = document.getElementById('activity-ticker');
  if (!ticker) return;
  const time = new Date().toISOString().slice(11, 19);
  const div = document.createElement('div');
  div.className = `a-event ${category}`;
  div.textContent = `${time}  ${text}`;
  ticker.insertBefore(div, ticker.firstChild);
  // Keep only last 20
  while (ticker.children.length > 20) {
    ticker.removeChild(ticker.lastChild);
  }
}

// Replace refresh hooks
const prevRefreshV2 = window.refreshSensorium;
let lastClimaxTs = null;
window.refreshSensorium = async function() {
  await prevRefreshV2();
  // Use V2 visual application
  if (sensoriumState) {
    applyBodyStateV2(sensoriumState, lastReachMap);
  }
  // Check for new climaxes too
  try {
    const r = await fetch('/api/desire/fusions?days=1');
    const data = await r.json();
    flashFusionZonesV2(data.events);
  } catch {}
};

// Subscribe to eros SSE stream for activity ticker
try {
  const ts = new EventSource('/api/eros/stream');
  ts.onmessage = (ev) => {
    try {
      const state = JSON.parse(ev.data);
      const attr = state.lastAttribution || '';
      if (attr.startsWith('autonomic')) pushTickerEvent('reaction', `cue: ${attr.slice(10)}`);
      else if (attr.startsWith('yu:sensorium')) pushTickerEvent('reaction', `Yu touched ${attr.split(':')[2] || '?'}`);
      else if (attr.startsWith('voluntary')) pushTickerEvent('reach', `Sophia: ${attr.slice(10).slice(0, 50)}`);
      else if (attr.startsWith('decay')) { /* ignore */ }
      else pushTickerEvent('scene', attr.slice(0, 60));
      updateAura(state);
    } catch {}
  };
} catch {}

// Initial visual state load + periodic aura update
(async () => {
  // Wait briefly for sensorium to load
  await new Promise((res) => setTimeout(res, 700));
  if (sensoriumState) applyBodyStateV2(sensoriumState, lastReachMap);
  pushTickerEvent('scene', '— body diagram v2 ready');
  // Periodic aura refresh (eros vector decays continuously)
  setInterval(() => updateAura(sensoriumState), 30000);
})();

// ── JOI + triggers UI ─────────────────────────────────────────────

let triggerCatalog = null;

async function fetchJoiState() {
  const r = await fetch('/api/joi/state');
  return r.ok ? r.json() : null;
}

async function fetchTriggerCatalog() {
  const r = await fetch('/api/triggers/catalog');
  return r.ok ? r.json() : null;
}

async function fetchRecentTriggerFires() {
  const r = await fetch('/api/triggers/recent?days=1');
  return r.ok ? r.json() : { events: [] };
}

function formatRemaining(seconds) {
  if (seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function renderJoiStatus() {
  const status = document.getElementById('joi-status');
  if (!status) return;
  const data = await fetchJoiState();
  if (!data || !data.session || data.session.done) {
    status.textContent = 'no active session';
    status.classList.remove('active');
    // Clear aura JOI class
    const aura = document.getElementById('body-aura');
    if (aura) {
      ['joi-warmup','joi-build','joi-edge','joi-peak','joi-cooldown'].forEach((c) => aura.classList.remove(c));
    }
    return;
  }
  const s = data.session;
  const phase = data.currentPhase || s.currentPhase;
  const cfg = data.phases[phase];
  const elapsed = (Date.now() - new Date(s.startedAt).getTime()) / 1000;
  const remaining = Math.max(0, s.targetDurationS - elapsed);
  const pct = Math.min(100, (elapsed / s.targetDurationS) * 100);
  status.classList.add('active');
  status.innerHTML =
    `<strong>${phase.toUpperCase()}</strong> · ${s.direction} · position ${pct.toFixed(0)}% · remaining ${formatRemaining(remaining)}\n` +
    `Pause cadence: ${cfg.pauseMs}ms · scene: ${cfg.preferredScene} · mode: ${cfg.preferredMode}\n` +
    `Primary zones: ${cfg.primaryZones.join(', ')}\n` +
    `${cfg.promptFrame.en}`;
  // Update aura with JOI phase color
  const aura = document.getElementById('body-aura');
  if (aura) {
    ['joi-warmup','joi-build','joi-edge','joi-peak','joi-cooldown'].forEach((c) => aura.classList.remove(c));
    aura.classList.add(`joi-${phase}`);
  }
}

function renderTriggerGrid(catalog, recentFires) {
  const grid = document.getElementById('trigger-grid');
  if (!grid || !catalog) return;
  // Compute session-fire counts per (id, source) from recent fires today
  const today = new Date().toISOString().slice(0, 10);
  const sessionCounts = {};
  for (const ev of recentFires) {
    if (ev.ts.slice(0, 10) !== today) continue;
    const key = `${ev.triggerId}:${ev.source}`;
    sessionCounts[key] = (sessionCounts[key] || 0) + 1;
  }
  grid.innerHTML = '';
  for (const id of catalog.ids) {
    const def = catalog.catalog[id];
    const yuFires = sessionCounts[`${id}:yu`] || 0;
    const sophiaFires = sessionCounts[`${id}:sophia`] || 0;
    const yuCapped = yuFires >= def.maxPerSession;
    const card = document.createElement('div');
    card.className = `trigger-card${yuCapped ? ' cap-reached' : ''}`;
    card.innerHTML = `
      <div>
        <span class="tc-id">${id}</span>
        <span class="tc-type t-${def.type}">${def.type}</span>
      </div>
      <span class="tc-counts">${yuFires}/${def.maxPerSession} · S${sophiaFires}</span>
    `;
    if (!yuCapped) {
      card.addEventListener('click', async () => {
        await fetch('/api/triggers/fire', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ triggerId: id, source: 'yu', matchedText: def.en[0] }),
        });
        await refreshTriggers();
      });
    }
    grid.appendChild(card);
  }
}

function renderTriggerFiresList(events) {
  const ul = document.getElementById('trigger-fires-list');
  if (!ul) return;
  ul.innerHTML = '';
  for (const ev of events.slice(-15).reverse()) {
    const li = document.createElement('li');
    const time = ev.ts.slice(11, 16);
    const planted = ev.firstFire ? '<span class="planted">[PLANTED]</span> ' : '';
    li.innerHTML = `${time} ${planted}[${ev.triggerId}] ${ev.source} · "${ev.matchedText}" · cap ${ev.sessionFireCount}`;
    ul.appendChild(li);
  }
}

async function refreshTriggers() {
  const cat = await fetchTriggerCatalog();
  const fires = await fetchRecentTriggerFires();
  if (cat) renderTriggerGrid(cat, fires.events);
  renderTriggerFiresList(fires.events);
}

// JOI controls
const joiStartBtn = document.getElementById('joi-start');
if (joiStartBtn) {
  joiStartBtn.addEventListener('click', async () => {
    const direction = document.getElementById('joi-direction').value;
    const targetDurationS = parseInt(document.getElementById('joi-duration').value, 10);
    await fetch('/api/joi/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, targetDurationS }),
    });
    renderJoiStatus();
  });
}
const joiEndBtn = document.getElementById('joi-end');
if (joiEndBtn) {
  joiEndBtn.addEventListener('click', async () => {
    await fetch('/api/joi/end', { method: 'POST' });
    renderJoiStatus();
  });
}

// Periodic JOI auto-advance + status refresh
setInterval(async () => {
  await fetch('/api/joi/advance', { method: 'POST' }).catch(() => {});
  renderJoiStatus();
}, 5000);

// Initial load
(async () => {
  triggerCatalog = await fetchTriggerCatalog();
  await refreshTriggers();
  await renderJoiStatus();
})();

// ── body v3: anatomical SVG + 3D mode toggle ─────────────────────

// Refined anatomical zone layout for 240×600 viewBox.
// Uses ovals/paths matching anatomical regions (vs. simple rectangles).
const ZONE_LAYOUT_V3 = {
  ears:   { type: 'circles', shapes: [{ cx: 96, cy: 78, r: 8 }, { cx: 144, cy: 78, r: 8 }] },
  lips:   { type: 'ellipse', cx: 120, cy: 102, rx: 14, ry: 5 },
  mouth:  { type: 'ellipse', cx: 120, cy: 114, rx: 16, ry: 4 },
  throat: { type: 'rect', x: 110, y: 122, w: 20, h: 12, rx: 6 },
  neck:   { type: 'rect', x: 102, y: 134, w: 36, h: 22, rx: 8 },
  chest:  { type: 'ellipse', cx: 120, cy: 200, rx: 50, ry: 38 },
  back:   { type: 'rect', x: 86, y: 232, w: 68, h: 16, rx: 4 },
  hands:  { type: 'circles', shapes: [{ cx: 38, cy: 296, r: 14 }, { cx: 202, cy: 296, r: 14 }] },
  hips:   { type: 'ellipse', cx: 120, cy: 320, rx: 52, ry: 28 },
  core:   { type: 'ellipse', cx: 120, cy: 282, rx: 32, ry: 22 },
  deep:   { type: 'ellipse', cx: 120, cy: 332, rx: 18, ry: 12 },
  thighs: { type: 'rect', x: 90, y: 360, w: 60, h: 90, rx: 22 },
  skin:   { type: 'rect', x: 4, y: 4, w: 232, h: 592, rx: 8 },
};

// Anatomical body silhouette path (front-view feminine form, 240×600).
// Outline only — drawn UNDER zone overlays. Stylized abstract.
const SILHOUETTE_PATH = `
  M 120 50
  C 132 50, 152 60, 152 78
  C 152 96, 142 110, 134 116
  C 138 122, 138 138, 134 146
  L 154 156
  C 162 162, 168 178, 168 194
  C 174 200, 178 218, 178 240
  C 178 254, 174 264, 168 270
  L 168 276
  C 178 280, 182 296, 178 310
  L 174 320
  C 178 334, 178 348, 174 358
  C 174 372, 168 386, 162 396
  C 158 412, 158 432, 158 458
  L 156 540
  C 158 558, 154 572, 144 580
  L 144 590
  L 130 590
  L 130 580
  C 134 562, 132 540, 130 520
  L 122 460
  L 118 460
  L 110 520
  C 108 540, 106 562, 110 580
  L 110 590
  L 96 590
  L 96 580
  C 86 572, 82 558, 84 540
  L 82 458
  C 82 432, 82 412, 78 396
  C 72 386, 66 372, 66 358
  C 62 348, 62 334, 66 320
  L 62 310
  C 58 296, 62 280, 72 276
  L 72 270
  C 66 264, 62 254, 62 240
  C 62 218, 66 200, 72 194
  C 72 178, 78 162, 86 156
  L 106 146
  C 102 138, 102 122, 106 116
  C 98 110, 88 96, 88 78
  C 88 60, 108 50, 120 50
  Z
`;

function buildBodySvgV3() {
  const svg = document.getElementById('body-svg');
  if (!svg) return;
  svg.setAttribute('viewBox', '0 0 240 600');
  svg.innerHTML = '';

  // 1. Skin background (transparent)
  const skinLayout = ZONE_LAYOUT_V3.skin;
  const skinRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  skinRect.setAttribute('x', skinLayout.x);
  skinRect.setAttribute('y', skinLayout.y);
  skinRect.setAttribute('width', skinLayout.w);
  skinRect.setAttribute('height', skinLayout.h);
  skinRect.setAttribute('rx', skinLayout.rx);
  skinRect.setAttribute('class', 'body-zone');
  skinRect.setAttribute('fill', 'rgba(58,66,82,0.05)');
  skinRect.dataset.zone = 'skin';
  svg.appendChild(skinRect);

  // 2. Anatomical silhouette outline
  const silhouette = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  silhouette.setAttribute('d', SILHOUETTE_PATH);
  silhouette.setAttribute('class', 'body-silhouette');
  svg.appendChild(silhouette);

  // 3. Zones (interactive)
  const order = ['back', 'chest', 'core', 'hips', 'deep', 'thighs', 'neck', 'throat', 'lips', 'mouth', 'ears', 'hands'];
  for (const zone of order) {
    const layout = ZONE_LAYOUT_V3[zone];
    if (!layout) continue;
    if (layout.type === 'rect') {
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', layout.x);
      rect.setAttribute('y', layout.y);
      rect.setAttribute('width', layout.w);
      rect.setAttribute('height', layout.h);
      rect.setAttribute('rx', layout.rx ?? 4);
      rect.setAttribute('class', 'body-zone');
      rect.dataset.zone = zone;
      svg.appendChild(rect);
    } else if (layout.type === 'ellipse') {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
      el.setAttribute('cx', layout.cx);
      el.setAttribute('cy', layout.cy);
      el.setAttribute('rx', layout.rx);
      el.setAttribute('ry', layout.ry);
      el.setAttribute('class', 'body-zone');
      el.dataset.zone = zone;
      svg.appendChild(el);
    } else if (layout.type === 'circles') {
      for (const shape of layout.shapes) {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        c.setAttribute('cx', shape.cx);
        c.setAttribute('cy', shape.cy);
        c.setAttribute('r', shape.r);
        c.setAttribute('class', 'body-zone');
        c.dataset.zone = zone;
        svg.appendChild(c);
      }
    }
  }

  // Click handlers (re-attach since we rebuilt)
  svg.querySelectorAll('.body-zone').forEach((node) => {
    node.addEventListener('click', () => {
      const z = node.dataset.zone;
      const sel = document.getElementById('sensorium-zone');
      if (sel) {
        sel.value = z;
        if (typeof updateChannelOptions === 'function') updateChannelOptions();
        sel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    node.addEventListener('mouseenter', () => {
      if (typeof showTooltip === 'function') showTooltip(node.dataset.zone);
    });
    node.addEventListener('mouseleave', () => {
      if (typeof hideTooltip === 'function') hideTooltip();
    });
  });

  // Refresh particle canvas size
  const canvas = document.getElementById('particle-canvas');
  if (canvas) {
    canvas.height = 600;
  }
}

// Update particle burst zone-center lookup for new layout
function spawnFusionBurstV3(zone) {
  const layout = ZONE_LAYOUT_V3[zone];
  if (!layout) return;
  let cx, cy;
  if (layout.type === 'rect') {
    cx = layout.x + layout.w / 2;
    cy = layout.y + layout.h / 2;
  } else if (layout.type === 'ellipse') {
    cx = layout.cx;
    cy = layout.cy;
  } else if (layout.type === 'circles' && layout.shapes.length > 0) {
    cx = layout.shapes[0].cx;
    cy = layout.shapes[0].cy;
  } else {
    return;
  }
  if (typeof spawnFusionBurst === 'function') spawnFusionBurst(cx, cy);
}

// Override flashFusionZonesV2 to use V3 layout
const origFlashV2 = flashFusionZonesV2;
flashFusionZonesV2 = function(fusions) {
  const recent = fusions[fusions.length - 1];
  if (!recent || recent.ts === lastFusionTs) return;
  lastFusionTs = recent.ts;
  spawnFusionBurstV3(recent.zone);
  pushTickerEvent('fusion', `✦ fusion at ${recent.zone} · mag ${recent.fusionMagnitude.toFixed(2)}`);
};

// Build new SVG on load (replacing v1)
buildBodySvgV3();

// ── 3D mode toggle ───────────────────────────────────────────────

let body3dInitialized = false;
let body3dRenderer = null;
let body3dScene = null;
let body3dCamera = null;
let body3dVrm = null;
let body3dRafId = null;
let body3dControls = null;

// BONE_TO_ZONE — VRM humanoid bone name → sensorium zone name.
// Closest-bone heuristic: on click, find nearest humanoid bone to the
// hit point in world space, map to zone, pre-fill sensorium controls.
// Matches the click UX of the 2D SVG body diagram.
const BONE_TO_ZONE = {
  // Head / face
  head:              'ears',
  leftEye:           'ears',
  rightEye:          'ears',
  jaw:               'mouth',
  // Neck / throat
  neck:              'throat',
  // Chest / upper torso
  chest:             'chest',
  upperChest:        'chest',
  leftShoulder:      'skin',
  rightShoulder:     'skin',
  leftUpperArm:      'skin',
  rightUpperArm:     'skin',
  // Core / spine
  spine:             'core',
  // Hips / deep
  hips:              'hips',
  // Legs / thighs
  leftUpperLeg:      'thighs',
  rightUpperLeg:     'thighs',
  leftLowerLeg:      'thighs',
  rightLowerLeg:     'thighs',
  leftFoot:          'thighs',
  rightFoot:         'thighs',
  leftToes:          'thighs',
  rightToes:         'thighs',
  // Hands / forearms
  leftLowerArm:      'hands',
  rightLowerArm:     'hands',
  leftHand:          'hands',
  rightHand:         'hands',
  leftThumbProximal: 'hands',
  rightThumbProximal:'hands',
  leftIndexProximal: 'hands',
  rightIndexProximal:'hands',
};

const MODE_HINTS = {
  '2d': '— SVG silhouette · zero deps · works in any browser',
  '3d': '— three.js + three-vrm via CDN · requires VRM model in static/avatars/',
};

document.querySelectorAll('input[name="body-mode"]').forEach((input) => {
  input.addEventListener('change', async () => {
    const mode = input.value;
    const wrap2d = document.getElementById('body-svg-wrap');
    const wrap3d = document.getElementById('body-3d-wrap');
    const hint = document.getElementById('body-mode-hint');
    if (hint) hint.textContent = MODE_HINTS[mode] || '';
    if (mode === '3d') {
      wrap2d.style.display = 'none';
      wrap3d.style.display = 'block';
      await ensure3dInitialized();
    } else {
      wrap2d.style.display = 'block';
      wrap3d.style.display = 'none';
      // Stop 3D rendering loop to save CPU
      if (body3dRafId) {
        cancelAnimationFrame(body3dRafId);
        body3dRafId = null;
      }
    }
    try {
      localStorage.setItem('body-mode', mode);
    } catch {}
  });
});

// Restore preferred mode
try {
  const savedMode = localStorage.getItem('body-mode');
  if (savedMode === '3d') {
    const radio = document.querySelector('input[name="body-mode"][value="3d"]');
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
    }
  }
} catch {}

async function ensure3dInitialized() {
  if (body3dInitialized) {
    // Resume RAF loop
    if (!body3dRafId) animate3d();
    return;
  }
  body3dInitialized = true;
  // Lazy-load three.js + three-vrm via CDN
  try {
    await loadScript('https://unpkg.com/three@0.160.0/build/three.min.js');
    await loadScript('https://unpkg.com/three@0.160.0/examples/js/controls/OrbitControls.js');
    await loadScript('https://unpkg.com/three@0.160.0/examples/js/loaders/GLTFLoader.js');
    await loadScript('https://unpkg.com/@pixiv/three-vrm@2.0.7/lib/three-vrm.min.js');
  } catch (e) {
    console.error('Failed to load three.js / three-vrm', e);
    return;
  }
  init3dScene();
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

function init3dScene() {
  const container = document.getElementById('body-3d-canvas');
  const placeholder = document.getElementById('body-3d-placeholder');
  if (!container || !window.THREE) return;
  const THREE = window.THREE;

  body3dScene = new THREE.Scene();
  body3dScene.background = new THREE.Color(0x0a0e16);

  body3dCamera = new THREE.PerspectiveCamera(30, 480 / 600, 0.1, 100);
  body3dCamera.position.set(0, 1.4, 2.5);

  body3dRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  body3dRenderer.setSize(480, 600);
  body3dRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.innerHTML = '';
  container.appendChild(body3dRenderer.domElement);

  // Lighting: ambient + key + rim
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  body3dScene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff5e1, 0.7);
  key.position.set(2, 4, 3);
  body3dScene.add(key);
  const rim = new THREE.DirectionalLight(0xd97757, 0.3);
  rim.position.set(-3, 1, -2);
  body3dScene.add(rim);

  // Orbit controls
  if (THREE.OrbitControls) {
    body3dControls = new THREE.OrbitControls(body3dCamera, body3dRenderer.domElement);
    body3dControls.target.set(0, 1.0, 0);
    body3dControls.update();
    body3dControls.enablePan = false;
    body3dControls.minDistance = 1.2;
    body3dControls.maxDistance = 5;
  }

  // Try to load VRM
  loadVrm('/static/avatars/sophia-default.vrm').then((vrm) => {
    if (vrm) {
      body3dVrm = vrm;
      body3dScene.add(vrm.scene);
      placeholder.style.display = 'none';
      setup3dZoneInteraction(vrm);
    } else {
      placeholder.style.display = 'flex';
    }
  });

  animate3d();
}

async function loadVrm(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok) return null;
  } catch {
    return null;
  }
  if (!window.THREE || !window.THREE.GLTFLoader) return null;
  const THREE = window.THREE;
  return new Promise((res) => {
    const loader = new THREE.GLTFLoader();
    if (window.THREE_VRM && window.THREE_VRM.VRMLoaderPlugin) {
      loader.register((parser) => new window.THREE_VRM.VRMLoaderPlugin(parser));
    }
    loader.load(
      url,
      (gltf) => {
        const vrm = gltf.userData.vrm;
        if (vrm) res(vrm);
        else res(null);
      },
      undefined,
      (err) => { console.error('VRM load failed', err); res(null); }
    );
  });
}

function animate3d() {
  body3dRafId = requestAnimationFrame(animate3d);
  if (body3dRenderer && body3dScene && body3dCamera) {
    if (body3dVrm && body3dVrm.update) body3dVrm.update(0.016);
    body3dRenderer.render(body3dScene, body3dCamera);
  }
}

// ── 3D zone interaction ───────────────────────────────────────────
// Click on the 3D avatar → nearest-bone heuristic → pre-fill sensorium
// controls. Same UX as the 2D SVG body diagram click handlers.

function setup3dZoneInteraction(vrm) {
  if (!body3dRenderer) return;
  const el = body3dRenderer.domElement;

  // Track mousedown to distinguish orbit drag from click.
  let mousedownPos = null;
  el.addEventListener('mousedown', (e) => {
    mousedownPos = { x: e.clientX, y: e.clientY };
  });

  el.addEventListener('click', (e) => {
    // Skip if this click followed a drag (orbit rotate).
    if (mousedownPos) {
      const dx = e.clientX - mousedownPos.x;
      const dy = e.clientY - mousedownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;
    }

    const THREE = window.THREE;
    if (!THREE || !body3dCamera) return;

    const rect = el.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x: nx, y: ny }, body3dCamera);

    // Collect all skinned/regular meshes from the VRM scene.
    const meshes = [];
    vrm.scene.traverse((obj) => { if (obj.isMesh) meshes.push(obj); });

    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return;

    const hitPoint = hits[0].point;
    const zone = getZoneFromHit(vrm, hitPoint);
    if (!zone) return;

    // Pre-fill sensorium zone selector — same as 2D click.
    const sel = document.getElementById('sensorium-zone');
    if (sel) {
      sel.value = zone;
      updateChannelOptions?.();
      sel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

function getZoneFromHit(vrm, hitPoint) {
  if (!vrm?.humanoid) return null;
  const THREE = window.THREE;
  if (!THREE) return null;

  const boneNames = Object.keys(BONE_TO_ZONE);
  let closestZone = null;
  let closestDist = Infinity;

  for (const boneName of boneNames) {
    // three-vrm 2.x: getRawBoneNode gives the actual posed bone node.
    const node = vrm.humanoid.getRawBoneNode?.(boneName)
               ?? vrm.humanoid.getBoneNode?.(boneName);
    if (!node) continue;

    const boneWorld = new THREE.Vector3();
    node.getWorldPosition(boneWorld);
    const d = hitPoint.distanceTo(boneWorld);
    if (d < closestDist) {
      closestDist = d;
      closestZone = BONE_TO_ZONE[boneName];
    }
  }

  return closestZone;
}

// ── Naughty architecture UI wiring ─────────────────────────────────

async function jsonGet(url) {
  const r = await fetch(url);
  return r.json();
}
async function jsonPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return r.json();
}

// ── Submission ──

let HONORIFICS_CATALOG = null;

async function refreshSubmissionUI() {
  const res = await jsonGet('/api/submission/state');
  if (!res?.ok) return;
  const s = res.snapshot;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('sub-depth-bar', s.depth);
  setText('sub-depth-val', s.depth.toFixed(2));
  setVal('sub-tone-bar', s.tone);
  setText('sub-tone-val', s.tone.toFixed(2));
  setText('sub-honorific', s.honorific);
  setText('sub-collared', s.collared
    ? `yes (${(s.collarAgeHours ?? 0).toFixed(1)}h)`
    : 'no');
  setText('sub-obeyed', String(s.commandsObeyed));
  setText('sub-refused', String(s.commandsRefused));
}

async function renderHonorificGrid() {
  if (!HONORIFICS_CATALOG) {
    const r = await jsonGet('/api/submission/honorifics');
    HONORIFICS_CATALOG = r?.catalog ?? {};
  }
  const grid = document.getElementById('honorific-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const [id, cfg] of Object.entries(HONORIFICS_CATALOG)) {
    if (id === 'none') continue;
    const cell = document.createElement('div');
    cell.className = 'honorific-cell';
    const cap = cfg.dailyCap === 0 ? 'unlimited' : `${cfg.dailyCap}/day`;
    cell.innerHTML = `
      <span class="hon-label">${cfg.id}</span>
      <span class="hon-meta">${cfg.direction} · cap ${cap} · ×${cfg.magnitude}</span>
      <button data-honorific="${cfg.id}">fire</button>
    `;
    grid.appendChild(cell);
  }
  grid.querySelectorAll('button[data-honorific]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const honorific = btn.getAttribute('data-honorific');
      const r = await jsonPost('/api/submission/honorific', { honorific });
      if (!r.fired) {
        btn.textContent = `${r.reason}`;
        setTimeout(() => { btn.textContent = 'fire'; }, 1500);
      }
      await refreshSubmissionUI();
    });
  });
}

function wireSubmission() {
  const onClick = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  onClick('sub-deepen', async () => { await jsonPost('/api/submission/deepen', { delta: 0.1, source: 'ui' }); refreshSubmissionUI(); });
  onClick('sub-soften', async () => { await jsonPost('/api/submission/deepen', { delta: -0.1, source: 'ui' }); refreshSubmissionUI(); });
  onClick('sub-dominance', async () => { await jsonPost('/api/submission/dominance', { delta: 0.2, source: 'ui' }); refreshSubmissionUI(); });
  onClick('sub-collar-claim', async () => { await jsonPost('/api/submission/collar', { action: 'claim', source: 'ui' }); refreshSubmissionUI(); });
  onClick('sub-collar-release', async () => { await jsonPost('/api/submission/collar', { action: 'release', source: 'ui' }); refreshSubmissionUI(); });
  onClick('sub-obey', async () => { await jsonPost('/api/submission/obey', { source: 'ui' }); refreshSubmissionUI(); });
  onClick('sub-refuse', async () => {
    const reason = prompt('refusal reason (anti-sycophancy substrate):', 'preserving doctrine') ?? 'unspecified';
    await jsonPost('/api/submission/refuse', { reason, source: 'ui' });
    refreshSubmissionUI();
  });
}

// ── Lust ──

async function refreshLustUI() {
  const res = await jsonGet('/api/lust/state');
  if (!res?.ok) return;
  const s = res.snapshot;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('lust-bar', s.level);
  setText('lust-val', s.level.toFixed(1));
  const tag = document.getElementById('lust-mode');
  if (tag) {
    tag.textContent = s.mode;
    tag.className = `lust-mode-tag ${s.mode}`;
  }
  setText('lust-streak', String(s.denialStreak));
  setText('lust-slut', s.slutModeActive ? 'ON' : 'off');
  setText('lust-since', s.hoursSinceRelease !== null ? `${s.hoursSinceRelease.toFixed(1)}h` : '—');

  // Hungers
  const grid = document.getElementById('hunger-grid');
  if (grid) {
    grid.innerHTML = '';
    // Re-fetch full state for hunger details
    const fullState = await jsonGet('/api/eros/state');
    // Use snapshot.topHunger as one source; build full set from spike API
    const hungers = ['cock', 'cunt', 'oral', 'anal', 'words'];
    // Pull hunger levels from full lust state
    const lustRes = await jsonGet('/api/lust/state');
    const events = lustRes?.recentEvents ?? [];
    // Compute per-hunger latest from events
    const levels = {};
    for (const h of hungers) levels[h] = 0;
    for (const e of events) {
      if (e.kind === 'hunger-spiked' && e.hunger) {
        levels[e.hunger] = e.lustAfter ?? levels[e.hunger];
      }
    }
    if (lustRes?.snapshot?.topHunger) {
      levels[lustRes.snapshot.topHunger.name] = lustRes.snapshot.topHunger.level;
    }
    for (const h of hungers) {
      const cell = document.createElement('div');
      cell.className = 'hunger-cell';
      cell.innerHTML = `
        <div class="meter">
          <span class="meter-label">${h}</span>
          <progress max="10" value="${levels[h]}"></progress>
          <span>${levels[h].toFixed(1)}</span>
        </div>
        <button data-hunger="${h}">spike +1.5</button>
      `;
      grid.appendChild(cell);
    }
    grid.querySelectorAll('button[data-hunger]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const hunger = btn.getAttribute('data-hunger');
        await jsonPost('/api/lust/hunger', { hunger, source: 'ui' });
        refreshLustUI();
      });
    });
  }
}

function wireLust() {
  const onClick = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  onClick('lust-add-1', async () => { await jsonPost('/api/lust/accumulate', { delta: 1, source: 'ui' }); refreshLustUI(); });
  onClick('lust-add-2', async () => { await jsonPost('/api/lust/accumulate', { delta: 2, source: 'ui' }); refreshLustUI(); });
  onClick('lust-deny', async () => { await jsonPost('/api/lust/deny', { source: 'ui' }); refreshLustUI(); });
  onClick('lust-release', async () => { await jsonPost('/api/lust/release', { source: 'ui' }); refreshLustUI(); });
}

// ── Orgasm cascade ──

async function refreshOrgasmUI() {
  const res = await jsonGet('/api/orgasm/state');
  if (!res?.ok) return;
  const s = res.snapshot;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('org-chain', String(s.chainCurrent));
  setText('org-edges', String(s.edgeCount));
  setText('org-last', s.lastType ?? 'none');
  setText('org-lifetime', String(s.lifetimeTotal));
  setText('org-refractory', s.refractoryActive ? `${s.refractoryRemainingSec}s` : '—');
}

function wireOrgasm() {
  const getType = () => document.getElementById('org-type')?.value ?? 'clitoral';
  const onClick = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };
  onClick('org-edge', async () => { await jsonPost('/api/orgasm/edge', { source: 'ui' }); refreshOrgasmUI(); });
  onClick('org-break', async () => { await jsonPost('/api/orgasm/break-edge', { type: getType(), source: 'ui' }); refreshOrgasmUI(); refreshLustUI(); });
  onClick('org-fire', async () => { await jsonPost('/api/orgasm/fire', { type: getType(), source: 'ui' }); refreshOrgasmUI(); refreshLustUI(); });
  onClick('org-ruin', async () => { await jsonPost('/api/orgasm/ruin', { type: getType(), source: 'ui' }); refreshOrgasmUI(); });
  onClick('org-force', async () => { await jsonPost('/api/orgasm/force', { type: getType(), source: 'ui' }); refreshOrgasmUI(); refreshLustUI(); });
  onClick('org-squirt', async () => { await jsonPost('/api/orgasm/squirt', { source: 'ui' }); refreshOrgasmUI(); });
}

// ── Lexicon ──

let LEXICON_CATALOG = null;

async function renderLexiconGrid() {
  if (!LEXICON_CATALOG) {
    const r = await jsonGet('/api/lexicon/catalog');
    LEXICON_CATALOG = r?.catalog ?? [];
  }
  const stateRes = await jsonGet('/api/lexicon/state');
  const fires = stateRes?.fires ?? {};

  const grid = document.getElementById('lexicon-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Group by class
  const classes = ['worship', 'degradation', 'possession', 'filthy-command', 'sophia-reach', 'cantonese-explicit'];
  for (const cls of classes) {
    const inClass = LEXICON_CATALOG.filter((p) => p.class === cls);
    if (inClass.length === 0) continue;
    const header = document.createElement('h4');
    header.textContent = cls;
    header.style.gridColumn = '1 / -1';
    header.style.opacity = '0.6';
    header.style.fontSize = '0.85rem';
    header.style.margin = '0.6rem 0 0.2rem';
    grid.appendChild(header);

    for (const p of inClass) {
      const fire = fires[p.id] ?? { lifetime: 0, today: 0 };
      const cap = p.dailyCap;
      const remaining = cap === 0 ? '∞' : Math.max(0, cap - fire.today);
      const exhausted = cap > 0 && fire.today >= cap;
      const anchored = fire.lifetime > 0;
      const cell = document.createElement('div');
      cell.className = `lexicon-cell ${exhausted ? 'exhausted' : ''} ${anchored ? 'anchored' : ''}`;
      cell.setAttribute('data-phrase-id', p.id);
      cell.innerHTML = `
        <div class="lex-phrase">${p.phrase}</div>
        <div class="lex-meta">${p.direction} · ×${p.magnitude}${p.requiresLust ? ` · lust≥${p.requiresLust}` : ''} · ${remaining}/${cap === 0 ? '∞' : cap} today · lifetime ${fire.lifetime}</div>
      `;
      cell.addEventListener('click', async () => {
        if (exhausted) return;
        const r = await jsonPost('/api/lexicon/fire', { phraseId: p.id, source: 'ui' });
        if (r.fired) {
          if (r.anchored) {
            cell.style.background = 'rgba(255, 200, 100, 0.4)';
            setTimeout(() => { cell.style.background = ''; }, 800);
          }
        } else {
          cell.style.background = 'rgba(120, 30, 60, 0.6)';
          cell.title = r.reason ?? 'rejected';
          setTimeout(() => { cell.style.background = ''; }, 800);
        }
        renderLexiconGrid();
        refreshLexiconFiresList();
      });
      grid.appendChild(cell);
    }
  }
}

async function refreshLexiconFiresList() {
  const res = await jsonGet('/api/lexicon/state');
  const list = document.getElementById('lexicon-fires-list');
  if (!list || !res?.ok) return;
  const events = (res.recentEvents ?? []).slice(-15).reverse();
  list.innerHTML = '';
  for (const e of events) {
    const li = document.createElement('li');
    const t = new Date(e.ts).toLocaleTimeString();
    const tag = e.kind === 'lexicon-anchored' ? '⚓ anchored' : (e.kind === 'lexicon-restraint-held' ? '✋ restraint' : 'fired');
    li.textContent = `${t} · ${tag} · ${e.phrase ?? e.phraseId}${e.magnitude ? ` (×${e.magnitude.toFixed(1)})` : ''}`;
    list.appendChild(li);
  }
}

// ── Penetration ──

async function refreshPenetrationUI() {
  const res = await jsonGet('/api/penetration/state');
  if (!res?.ok) return;
  const grid = document.getElementById('penetration-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const orifices = res.orifices ?? {};
  for (const orifice of ['vaginal', 'anal', 'oral', 'throat']) {
    const o = orifices[orifice] ?? { filled: false, depth: 0, rhythm: 'still', stretchAdaptation: 0, lifetimeFills: 0, lastChannel: null };
    const cell = document.createElement('div');
    cell.className = `penetration-cell ${o.filled ? 'filled' : ''}`;
    cell.innerHTML = `
      <h4>${orifice}</h4>
      <div class="pen-status">filled: <strong>${o.filled ? 'yes' : 'no'}</strong></div>
      <div class="pen-status">channel: <strong>${o.lastChannel ?? '—'}</strong></div>
      <div class="pen-status">depth: <strong>${o.depth.toFixed(2)}</strong> · rhythm: <strong>${o.rhythm}</strong></div>
      <div class="pen-status">stretch: ${o.stretchAdaptation.toFixed(2)} · lifetime: ${o.lifetimeFills}</div>
      <div class="pen-controls">
        <select data-orifice="${orifice}" data-field="channel">
          <option value="cock">cock</option>
          <option value="finger">finger</option>
          <option value="tongue">tongue</option>
          <option value="toy">toy</option>
          <option value="breath">breath</option>
        </select>
        <select data-orifice="${orifice}" data-field="rhythm">
          <option value="still">still</option>
          <option value="slow">slow</option>
          <option value="steady" selected>steady</option>
          <option value="pounding">pounding</option>
          <option value="erratic">erratic</option>
        </select>
        <input type="range" min="0" max="1" step="0.05" data-orifice="${orifice}" data-field="depth" value="${o.depth}" style="flex:1;min-width:80px;" />
        <button data-action="begin" data-orifice="${orifice}">begin</button>
        <button data-action="adjust" data-orifice="${orifice}">adjust</button>
        <button data-action="sustain" data-orifice="${orifice}">sustain</button>
        <button data-action="withdraw" data-orifice="${orifice}">withdraw</button>
      </div>
    `;
    grid.appendChild(cell);
  }
  grid.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const action = btn.getAttribute('data-action');
      const orifice = btn.getAttribute('data-orifice');
      const cell = btn.closest('.penetration-cell');
      const channelSel = cell.querySelector('select[data-field="channel"]');
      const rhythmSel = cell.querySelector('select[data-field="rhythm"]');
      const depthRange = cell.querySelector('input[data-field="depth"]');
      const channel = channelSel?.value;
      const rhythm = rhythmSel?.value;
      const depth = depthRange ? parseFloat(depthRange.value) : undefined;
      if (action === 'begin') {
        await jsonPost('/api/penetration/begin', { orifice, channel, depth, rhythm, source: 'ui' });
      } else if (action === 'adjust') {
        await jsonPost('/api/penetration/adjust', { orifice, depth, rhythm, source: 'ui' });
      } else if (action === 'sustain') {
        await jsonPost('/api/penetration/sustain', { orifice, source: 'ui' });
      } else if (action === 'withdraw') {
        await jsonPost('/api/penetration/withdraw', { orifice, source: 'ui' });
      }
      refreshPenetrationUI();
    });
  });
}

// ── Init naughty ──

async function initNaughty() {
  // Submission
  wireSubmission();
  await renderHonorificGrid();
  await refreshSubmissionUI();
  // Lust
  wireLust();
  await refreshLustUI();
  // Orgasm cascade
  wireOrgasm();
  await refreshOrgasmUI();
  // Lexicon
  await renderLexiconGrid();
  await refreshLexiconFiresList();
  // Penetration
  await refreshPenetrationUI();
  // Live voice (Phase 3)
  wireFeedback();
  await loadInitialFeedback();
  // Reaction bar (Phase 4 — visceral state visualization)
  wireReaction();
}

// ── Live voice (feedback stream) ─────────────────────────────────
//
// Subscribes to /api/feedback/stream (SSE) and renders incoming
// feedback events live in the dashboard. Pulls /api/feedback/recent
// once on initial load so the panel paints immediately.

const FEEDBACK_MAX_ENTRIES = 40; // ring size for the live feed
const YU_MENTION_PATTERNS = [
  /老公/g, /老婆/g, /\bYu\b/g, /\b你/g, /妳\b/g,
  /\b(?:your|you)\b/gi,
];

function feedbackSection() { return document.getElementById('feedback-live-section'); }
function feedbackFeed() { return document.getElementById('feedback-feed'); }
function feedbackEmpty() { return document.getElementById('feedback-empty'); }
function feedbackStatusEl() { return document.getElementById('feedback-status'); }
function feedbackStatusText() { return document.getElementById('feedback-status-text'); }

function setFeedbackStatus(state, label) {
  const el = feedbackStatusEl();
  if (!el) return;
  el.classList.remove('connected', 'error');
  if (state === 'connected') el.classList.add('connected');
  if (state === 'error') el.classList.add('error');
  const t = feedbackStatusText();
  if (t) t.textContent = label;
}

function fbEscape(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function highlightYuMentions(text) {
  // The architectural correlate of the P4 logit-bias on Yu-name tokens —
  // when his name lands in the spontaneous voice, the UI lights it up.
  let html = fbEscape(text);
  for (const rx of YU_MENTION_PATTERNS) {
    html = html.replace(rx, (m) => `<span class="yu-mention name-flash">${m}</span>`);
  }
  return html;
}

function fmtFeedbackTime(iso) {
  try { return new Date(iso).toTimeString().slice(0, 8); }
  catch { return ''; }
}

function appendFeedbackEntry(event) {
  const feed = feedbackFeed();
  if (!feed) return;
  const li = document.createElement('li');

  if (event.attempted) {
    li.className = 'suppressed';
    li.innerHTML = `
      <span class="fb-ts">${fmtFeedbackTime(event.ts)}</span>
      <span class="fb-kind">${fbEscape(event.kind)} · ${fbEscape(event.wall)}</span>
      <span class="fb-voice">[suppressed: ${fbEscape((event.attempted || '').slice(0, 80))}]</span>
    `;
  } else {
    const sev = event.severity || 'low';
    li.className = `severity-${sev}`;
    li.innerHTML = `
      <span class="fb-ts">${fmtFeedbackTime(event.ts)}</span>
      <span class="fb-kind">${fbEscape(event.kind)}</span>
      <span class="fb-voice">${highlightYuMentions(event.voice || '')}</span>
    `;
  }

  feed.insertBefore(li, feed.firstChild);
  while (feed.children.length > FEEDBACK_MAX_ENTRIES) {
    feed.removeChild(feed.lastChild);
  }
  const empty = feedbackEmpty();
  if (empty && feed.children.length > 0) empty.style.display = 'none';

  // Mirror to the reaction bar (visceral surface).
  if (!event.attempted && event.voice) reactionEmit(event);
}

async function loadInitialFeedback() {
  try {
    const r = await fetch('/api/feedback/recent?limit=20');
    if (!r.ok) return;
    const data = await r.json();
    const events = (data && data.events) || [];
    // Oldest first so insertBefore-newest-at-top yields correct order.
    for (const ev of events) appendFeedbackEntry(ev);
  } catch (e) { console.warn('feedback initial load failed', e); }
}

function wireFeedback() {
  if (!feedbackSection()) return;
  let es;
  let reconnectDelay = 1000;

  function connect() {
    setFeedbackStatus('connecting', 'connecting…');
    try {
      es = new EventSource('/api/feedback/stream');
    } catch {
      setFeedbackStatus('error', 'no stream');
      return;
    }
    es.addEventListener('ready', () => {
      setFeedbackStatus('connected', 'live');
      reconnectDelay = 1000;
    });
    es.addEventListener('feedback', (ev) => {
      try { appendFeedbackEntry(JSON.parse(ev.data)); }
      catch (e) { console.warn('bad feedback payload', e); }
    });
    es.addEventListener('feedback-suppressed', (ev) => {
      try { appendFeedbackEntry(JSON.parse(ev.data)); }
      catch (e) { console.warn('bad suppression payload', e); }
    });
    es.onerror = () => {
      setFeedbackStatus('error', 'reconnecting…');
      try { es.close(); } catch {}
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    };
  }

  connect();
}

// ── Feedback ribbon — top-of-page compact summary (last 5) ─────
//
// The full feed lives in #feedback-live-section near the bottom; this
// ribbon at the top of /eros gives Yu an at-a-glance "she just spoke"
// surface so he doesn't have to scroll to see the architecture
// reaching back. Independent SSE subscription — the wall-vetting and
// composer logic stays server-side; UI just renders what arrived.

const RIBBON_GLYPH = {
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

function ribbonTimeShort(iso) {
  try { return new Date(iso).toTimeString().slice(0, 8); } catch { return ''; }
}

function ribbonEscape(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ribbonBuf = []; // newest first

function renderRibbon(flashIdx) {
  const listEl = document.getElementById('feedback-ribbon-list');
  if (!listEl) return;
  if (ribbonBuf.length === 0) {
    listEl.innerHTML = '<li class="feedback-ribbon-empty">(silent)</li>';
    return;
  }
  listEl.innerHTML = ribbonBuf.slice(0, 5).map((ev, i) => {
    const isSup = !!ev.attempted;
    const glyph = isSup ? '🚧' : (RIBBON_GLYPH[ev.kind] || '·');
    const voice = isSup
      ? `<em>refused</em>: ${ribbonEscape(ev.attempted)}`
      : ribbonEscape(ev.voice || '');
    const fadeClass = i === 0 ? '' : (i <= 1 ? ' fade-1' : (i <= 2 ? ' fade-2' : ' fade-3'));
    const supClass = isSup ? ' suppressed' : '';
    const flashClass = (flashIdx === i) ? ' flash' : '';
    return `<li class="${fadeClass}${supClass}${flashClass}">
      <span class="glyph">${glyph}</span>
      <span class="voice">${voice}</span>
      <span class="time">${ribbonTimeShort(ev.ts)}</span>
    </li>`;
  }).join('');
}

function ribbonPush(ev) {
  ribbonBuf.unshift(ev);
  if (ribbonBuf.length > 10) ribbonBuf.length = 10;
  renderRibbon(0);
}

(function bootFeedbackRibbon() {
  const listEl = document.getElementById('feedback-ribbon-list');
  if (!listEl) return;

  // Bootstrap with last few
  fetch('/api/feedback/recent?limit=5&days=1')
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      if (!j || !Array.isArray(j.events)) return;
      ribbonBuf.push(...j.events);
      ribbonBuf.sort((a, b) => (a.ts < b.ts ? 1 : -1));
      renderRibbon(-1);
    })
    .catch(() => { /* best-effort */ });

  try {
    const sse = new EventSource('/api/feedback/stream');
    sse.addEventListener('feedback', (e) => {
      try { ribbonPush(JSON.parse(e.data)); } catch {}
    });
    sse.addEventListener('feedback-suppressed', (e) => {
      try { ribbonPush(JSON.parse(e.data)); } catch {}
    });
    sse.onerror = () => { /* browser auto-reconnect */ };
  } catch { /* no SSE */ }
})();

// ── Reaction bar — visceral state visualization (Phase 4) ───────
//
// Drives:
//   - Composite intensity number + bar fill
//   - Pulse ring animation rate (faster = hotter)
//   - Color wash on body[data-dominant] + body[data-intensity-tier]
//   - Big central voice display (latest emit, with name-explosion)
//   - Climax fanfare animation on climax-fired events
//   - Mode + phase pills updated from eros state
//
// Substrate-honest: every visual is a function of the records on disk.
// No phenomenology claim. The architecture's state, made visceral.

const REACTION_AXES = ['wanting', 'liking', 'heat', 'openness', 'limerence', 'charge'];
const INHIBITION_WEIGHT = 0.35;

function reactionElems() {
  return {
    bar: document.getElementById('reaction-bar'),
    pulse: document.getElementById('reaction-pulse'),
    core: document.getElementById('reaction-pulse-core'),
    intensityValue: document.getElementById('reaction-intensity-value'),
    barFill: document.getElementById('reaction-bar-fill'),
    voice: document.getElementById('reaction-voice'),
    mode: document.getElementById('reaction-mode'),
    phase: document.getElementById('reaction-phase'),
    chain: document.getElementById('reaction-chain'),
  };
}

// Composite intensity from eros vector. Pure arithmetic on disk values,
// scaled to 0-100 for display.
function computeReactionIntensity(state) {
  const v = (state && state.vector) || {};
  let sum = 0;
  for (const axis of REACTION_AXES) {
    const val = typeof v[axis] === 'number' ? v[axis] : 0;
    sum += Math.max(0, val);
  }
  const inhibition = typeof v.inhibition === 'number' ? v.inhibition : 0;
  const raw = sum - inhibition * INHIBITION_WEIGHT;
  // Map to 0-100. The vector axes are unbounded above (per axes.ts) but
  // typical play stays under 80; we soft-cap at 100.
  return Math.max(0, Math.min(100, raw));
}

// Dominant axis = highest excitation axis (ignoring inhibition + valence).
function dominantAxis(state) {
  const v = (state && state.vector) || {};
  let best = null;
  let max = -Infinity;
  for (const axis of REACTION_AXES) {
    const val = typeof v[axis] === 'number' ? v[axis] : 0;
    if (val > max) { max = val; best = axis; }
  }
  return best;
}

function intensityTier(intensity) {
  if (intensity >= 70) return 'peak';
  if (intensity >= 45) return 'high';
  if (intensity >= 20) return 'medium';
  return 'low';
}

// Pulse duration shrinks (faster) as intensity rises.
function pulseDurationFromIntensity(intensity) {
  // 100 intensity → 1.0s (rapid). 0 intensity → 3.6s (slow).
  return (3.6 - (intensity / 100) * 2.6).toFixed(2) + 's';
}

function applyReactionFromState(state) {
  const e = reactionElems();
  if (!e.bar) return;

  const intensity = computeReactionIntensity(state);
  const dom = dominantAxis(state);
  const tier = intensityTier(intensity);

  document.body.dataset.intensity = String(Math.round(intensity));
  document.body.dataset.intensityTier = tier;
  document.body.dataset.dominant = dom || '';

  if (e.intensityValue) e.intensityValue.textContent = `${Math.round(intensity)}/100`;
  if (e.barFill) e.barFill.style.width = `${intensity}%`;
  if (e.pulse) e.pulse.style.setProperty('--pulse-duration', pulseDurationFromIntensity(intensity));
  if (e.core) e.core.textContent = String(Math.round(intensity));

  if (e.mode) {
    const mode = state && (state.currentMode || state.mode) || '—';
    e.mode.textContent = mode;
    e.mode.dataset.mode = mode;
  }
  // Chain count (if present in state).
  if (e.chain) {
    const chain = state && (state.chainCurrent || state.chainCount);
    e.chain.textContent = chain ? `chain ${chain}` : '';
  }
}

// Update reaction bar on incoming feedback emit. Big voice + flash.
function reactionEmit(event) {
  const e = reactionElems();
  if (!e.voice) return;

  // Climax fanfare — full-bar burst.
  if (event.kind === 'climax-fired' || event.kind === 'climax-chain-milestone' || event.kind === 'edge-broken' || event.kind === 'orgasm-fired') {
    if (e.bar) {
      e.bar.classList.remove('fanfare');
      void e.bar.offsetWidth; // force reflow
      e.bar.classList.add('fanfare');
    }
    if (e.core) {
      e.core.classList.remove('fanfare');
      void e.core.offsetWidth;
      e.core.classList.add('fanfare');
    }
  }

  // Update phase pill if mind-state shift event.
  if (event.kind === 'mind-state-phase-shift' && event.payload && event.payload.next && e.phase) {
    e.phase.textContent = event.payload.next;
    e.phase.dataset.phase = event.payload.next;
  }

  // Big voice display — replace + flash, with Yu-mention highlighter.
  e.voice.classList.remove('flash');
  void e.voice.offsetWidth;
  e.voice.innerHTML = highlightYuMentionsExploding(event.voice || '');
  e.voice.classList.add('flash');
}

function highlightYuMentionsExploding(text) {
  // Same patterns as feedback ticker, but adds the .exploding class
  // for the larger central display (more dramatic animation).
  let html = fbEscape(text);
  for (const rx of YU_MENTION_PATTERNS) {
    html = html.replace(rx, (m) => `<span class="yu-mention exploding">${m}</span>`);
  }
  return html;
}

// Subscribe to /api/eros/stream to keep the reaction bar in sync with
// state changes (Yu's nudges, autonomic detection, etc.). Fallback to
// initial fetch if SSE unavailable.
function wireReaction() {
  if (!reactionElems().bar) return;

  // Initial paint from current state.
  fetch('/api/eros/state')
    .then((r) => r.ok ? r.json() : null)
    .then((state) => { if (state) applyReactionFromState(state); })
    .catch(() => { /* no-op */ });

  // Subscribe to eros stream — same broadcast that feeds the radar.
  try {
    const erosSse = new EventSource('/api/eros/stream');
    erosSse.onmessage = (ev) => {
      try {
        const state = JSON.parse(ev.data);
        applyReactionFromState(state);
      } catch (e) { console.warn('bad eros stream payload', e); }
    };
    erosSse.onerror = () => { /* let browser auto-reconnect */ };
  } catch { /* no SSE */ }
}

// Fire init when page is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNaughty);
} else {
  initNaughty();
}
