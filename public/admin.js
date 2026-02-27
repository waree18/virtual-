/* ════════════════════════════════════════════════
   Virtual Tour — Admin Panel  (admin.js)
════════════════════════════════════════════════ */

let currentScene = null;
let viewer       = null;
let scenes       = {};

/* ────────────────────────────────────────
   INIT
──────────────────────────────────────── */
(async function boot() {
  /* Session guard */
  try {
    const me = await (await fetch('/api/me')).json();
    if (!me.loggedIn) { location.href = '/login.html'; return; }
    document.getElementById('userName').textContent = me.username || me.email || 'Admin';
    document.getElementById('userAv').textContent   = (me.username || me.email || 'A')[0].toUpperCase();
  } catch (_) { /* allow offline development */ }

  await Promise.all([loadScenes(), loadStats()]);
})();

/* ────────────────────────────────────────
   SCENE LIST
──────────────────────────────────────── */
async function loadScenes() {
  try {
    const r = await fetch('/api/admin/scenes');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    scenes = await r.json();
  } catch (e) {
    toast('Failed to load scenes: ' + e.message, 'error');
    scenes = {};
  }
  renderSceneList();
}

function renderSceneList() {
  const el   = document.getElementById('sceneList');
  const keys = Object.keys(scenes);
  el.innerHTML = '';

  if (!keys.length) {
    el.innerHTML = '<p class="small" style="text-align:center;padding:20px;color:var(--text3)">No scenes yet.<br>Upload panoramas to begin.</p>';
    updateTargetDropdown();
    return;
  }

  keys.forEach((id, i) => {
    const div = document.createElement('div');
    div.className = 'scene-item' + (id === currentScene ? ' active' : '');
    div.dataset.id = id;
    div.draggable = true;
    div.style.animationDelay = (i * 28) + 'ms';
    div.innerHTML = `
      <span class="drag-handle" title="Drag to reorder" style="cursor:grab;font-size:14px;opacity:.45;flex-shrink:0;padding-right:4px;user-select:none">⠿</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(id)}">${esc(scenes[id].title || id)}</span>
      <button class="btn btn-danger btn-sm"
        style="padding:3px 9px;font-size:11px;flex-shrink:0;margin-left:6px"
        onclick="event.stopPropagation();confirmDeleteScene('${esc(id)}')">✕</button>`;
    div.onclick = () => selectScene(id);

    /* ── Drag & Drop ── */
    div.addEventListener('dragstart', onDragStart);
    div.addEventListener('dragover',  onDragOver);
    div.addEventListener('dragleave', onDragLeave);
    div.addEventListener('drop',      onDrop);
    div.addEventListener('dragend',   onDragEnd);

    el.appendChild(div);
  });

  updateTargetDropdown();
}

/* ── Drag state ── */
let dragSrc = null;

function onDragStart(e) {
  dragSrc = this;
  this.style.opacity = '0.45';
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', this.dataset.id);
}
function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (this !== dragSrc) {
    document.querySelectorAll('.scene-item').forEach(el => el.classList.remove('drag-over'));
    this.classList.add('drag-over');
  }
}
function onDragLeave() { this.classList.remove('drag-over'); }
function onDragEnd()   {
  this.style.opacity = '';
  document.querySelectorAll('.scene-item').forEach(el => el.classList.remove('drag-over'));
}
async function onDrop(e) {
  e.preventDefault();
  if (!dragSrc || dragSrc === this) return;
  this.classList.remove('drag-over');

  /* Reorder scenes object */
  const allIds   = Object.keys(scenes);
  const fromIdx  = allIds.indexOf(dragSrc.dataset.id);
  const toIdx    = allIds.indexOf(this.dataset.id);
  if (fromIdx === -1 || toIdx === -1) return;

  const reordered = [...allIds];
  reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, allIds[fromIdx]);

  /* Rebuild scenes in new order */
  const newScenes = {};
  reordered.forEach(id => { newScenes[id] = scenes[id]; });
  scenes = newScenes;

  renderSceneList();
  updateTargetDropdown();

  /* Persist to server */
  try {
    const r = await fetch('/api/scenes/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: reordered })
    });
    const j = await r.json();
    if (!j.success) throw new Error('Reorder failed');
    toast('Scene order saved', 'success');
  } catch (e) {
    toast('Reorder save failed: ' + e.message, 'error');
  }
}

function updateTargetDropdown() {
  const sel  = document.getElementById('hsTarget');
  const prev = sel.value;
  sel.innerHTML = '<option value="">— select target scene —</option>';
  Object.keys(scenes).forEach(id => {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = scenes[id].title || id;
    sel.appendChild(o);
  });
  if (prev && scenes[prev]) sel.value = prev;
}

function selectScene(id) {
  currentScene = id;
  const s = scenes[id];
  document.getElementById('sceneId').value    = id;
  document.getElementById('sceneTitle').value = s.title    || '';
  document.getElementById('sceneImage').value = s.panorama || '';
  renderSceneList();
  renderHotspots();
  s.panorama ? initViewer(s) : clearViewer('Fill in the image path and save.');
}

/* ────────────────────────────────────────
   PANNELLUM ADMIN PREVIEW
   Same fix as tour.html: single-scene config,
   no orientationOnByDefault.
──────────────────────────────────────── */
function initViewer(sceneData) {
  const c = document.getElementById('adminViewer');
  if (viewer) { try { viewer.destroy(); } catch (_) {} viewer = null; }
  c.innerHTML = '';
  c.style.height = '500px';

  const hotSpots = (sceneData.hotSpots || []).map(h => ({
    pitch: parseFloat(h.pitch) || 0,
    yaw:   parseFloat(h.yaw)   || 0,
    type:  'custom',
    createTooltipFunc: makeAdminArrow,
    createTooltipArgs: {
      targetId:    h.sceneId,
      targetTitle: scenes[h.sceneId]?.title || h.text || '→'
    }
  }));

  try {
    viewer = pannellum.viewer('adminViewer', {
      type:         'equirectangular',
      panorama:     sceneData.panorama,
      autoLoad:     true,
      showControls: true,
      orientationOnByDefault: false,   /* never in admin */
      hotSpots
    });

    /* Click anywhere on viewer → capture pitch/yaw */
    viewer.on('mousedown', e => {
      try {
        const c = viewer.mouseEventToCoords(e);
        if (Array.isArray(c) && c.length >= 2) {
          document.getElementById('hsPitch').value = c[0].toFixed(4);
          document.getElementById('hsYaw').value   = c[1].toFixed(4);
          highlightCoordFields();
        }
      } catch (_) {}
    });

    viewer.on('load', () => window.dispatchEvent(new Event('resize')));
  } catch (e) {
    c.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;
      color:#f66;font-size:13px;padding:20px;text-align:center">⚠ ${esc(e.message)}</div>`;
  }
}

/* Brief flash so user knows coordinates were captured */
function highlightCoordFields() {
  ['hsPitch', 'hsYaw'].forEach(id => {
    const el = document.getElementById(id);
    el.style.background = 'rgba(0,122,255,0.12)';
    el.style.borderColor = '#007aff';
    setTimeout(() => { el.style.background = ''; el.style.borderColor = ''; }, 800);
  });
}

/* Arrow hotspot for admin preview */
function makeAdminArrow(div, args) {
  Object.assign(div.style, {
    width: '56px', height: '56px',
    background: 'none', border: 'none',
    cursor: 'pointer', overflow: 'visible'
  });

  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'relative', width: '56px', height: '56px',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  });

  /* Pulse ring */
  const ring = document.createElement('div');
  Object.assign(ring.style, {
    position: 'absolute', inset: '0', borderRadius: '50%',
    border: '2px solid rgba(255,255,255,.3)',
    animation: 'hsRing 2.4s ease-out infinite'
  });

  /* Arrow button */
  const btn = document.createElement('div');
  Object.assign(btn.style, {
    width: '52px', height: '52px', borderRadius: '50%',
    background: 'rgba(0,0,0,.5)',
    border: '2px solid rgba(255,255,255,.75)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 20px rgba(0,0,0,.45)',
    transition: 'transform .2s, background .2s'
  });
  btn.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ' +
    'stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<line x1="12" y1="19" x2="12" y2="5"/>' +
    '<polyline points="5 12 12 5 19 12"/>' +
    '</svg>';

  /* Label */
  const lbl = document.createElement('div');
  Object.assign(lbl.style, {
    position: 'absolute', bottom: '-26px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,.8)', color: '#fff',
    fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '20px',
    whiteSpace: 'nowrap', pointerEvents: 'none',
    border: '1px solid rgba(255,255,255,.12)',
    fontFamily: '-apple-system,sans-serif'
  });
  lbl.textContent = args.targetTitle;

  /* Hover */
  btn.addEventListener('mouseenter', () => {
    btn.style.transform  = 'scale(1.2)';
    btn.style.background = 'rgba(0,122,255,.65)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform  = 'scale(1)';
    btn.style.background = 'rgba(0,0,0,.5)';
  });

  /* Click → switch to target in admin preview */
  div.addEventListener('click', e => {
    e.stopPropagation();
    if (args.targetId && scenes[args.targetId]) selectScene(args.targetId);
  });

  wrap.appendChild(ring);
  wrap.appendChild(btn);
  wrap.appendChild(lbl);
  div.appendChild(wrap);
}

function clearViewer(msg = 'Select a scene to preview') {
  if (viewer) { try { viewer.destroy(); } catch (_) {} viewer = null; }
  document.getElementById('adminViewer').innerHTML =
    `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
      height:100%;color:var(--text3);font-size:14px;gap:12px">
      <div style="font-size:36px;opacity:.25">🖼</div>
      <span>${esc(msg)}</span></div>`;
}

/* ────────────────────────────────────────
   HOTSPOTS
──────────────────────────────────────── */
function renderHotspots() {
  const el = document.getElementById('hotspotList');
  el.innerHTML = '';
  const hs = scenes[currentScene]?.hotSpots || [];

  if (!hs.length) {
    el.innerHTML = `<p class="small" style="color:var(--text3);padding:4px 0">
      No hotspots. Click inside the preview to capture pitch &amp; yaw, set type, then Add.</p>`;
    return;
  }

  hs.forEach((h, i) => {
    const row = document.createElement('div');
    row.className = 'hs-row';
    row.style.animationDelay = (i * 22) + 'ms';
    const typeIcon  = h.type === 'info' ? 'ℹ️' : '➤';
    const typeName  = h.type === 'info' ? 'info' : 'nav';
    const typeColor = h.type === 'info' ? '#ff9500' : 'var(--accent)';
    const dest = h.type === 'info'
      ? `<em style="color:#ff9500">${esc(h.text || 'Info')}</em>`
      : `→ <b>${esc(scenes[h.sceneId]?.title || h.sceneId || '?')}</b>`;
    row.innerHTML = `
      <span style="font-size:14px;flex-shrink:0">${typeIcon}</span>
      <span class="small" style="flex:1">
        <span style="background:${typeColor}22;color:${typeColor};border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;text-transform:uppercase">${typeName}</span>
        &nbsp;pitch <b>${(+h.pitch).toFixed(2)}</b> yaw <b>${(+h.yaw).toFixed(2)}</b>&nbsp;${dest}
      </span>
      <button class="btn btn-danger btn-sm" style="padding:2px 9px;font-size:11px"
        onclick="removeHotspot(${i})">✕</button>`;
    el.appendChild(row);
  });
}

function removeHotspot(i) {
  if (!currentScene) return;
  scenes[currentScene].hotSpots.splice(i, 1);
  renderHotspots();
  saveScene(false);      // silent save; viewer will refresh with new hotspot list
}

document.getElementById('btnAddHotspot').onclick = addHotspot;

/* Toggle nav/info fields based on type select */
document.getElementById('hsType').addEventListener('change', function() {
  const isInfo = this.value === 'info';
  document.getElementById('hsNavRow').style.display  = isInfo ? 'none' : '';
  document.getElementById('hsInfoRow').style.display = isInfo ? 'block' : 'none';
});

function addHotspot() {
  if (!currentScene) { toast('Select a scene first', 'error'); return; }

  const pitch  = parseFloat(document.getElementById('hsPitch').value);
  const yaw    = parseFloat(document.getElementById('hsYaw').value);
  const type   = document.getElementById('hsType').value;
  const label  = document.getElementById('hsLabel').value.trim() || (type==='info' ? 'Info' : '→');

  if (isNaN(pitch) || isNaN(yaw)) {
    toast('Click in the preview first to capture pitch & yaw', 'error'); return;
  }

  if (type === 'scene') {
    const target = document.getElementById('hsTarget').value;
    if (!target)               { toast('Select a target scene', 'error'); return; }
    if (target === currentScene) { toast('Hotspot target must be a different scene', 'error'); return; }
    if (!scenes[currentScene].hotSpots) scenes[currentScene].hotSpots = [];
    scenes[currentScene].hotSpots.push({
      pitch, yaw, rotation: 0, type: 'scene',
      sceneId: target, text: label || scenes[target]?.title || '→'
    });
  } else {
    const infoText = document.getElementById('hsInfoText').value.trim();
    if (!scenes[currentScene].hotSpots) scenes[currentScene].hotSpots = [];
    scenes[currentScene].hotSpots.push({
      pitch, yaw, rotation: 0, type: 'info',
      text: label, infoText
    });
  }

  renderHotspots();
  saveScene(true);
}

/* ────────────────────────────────────────
   SAVE / DELETE SCENE
──────────────────────────────────────── */
document.getElementById('btnSaveScene').onclick = () => saveScene(true);

async function saveScene(notify = true) {
  const id       = document.getElementById('sceneId').value;
  const title    = document.getElementById('sceneTitle').value.trim();
  const panorama = document.getElementById('sceneImage').value.trim();

  if (!title)    { toast('Enter a scene title', 'error');     return; }
  if (!panorama) { toast('Enter the image path', 'error');    return; }

  const sid = (id && id !== '(auto)') ? id : null;

  // Optimistically update local state
  if (sid) {
    scenes[sid]          = scenes[sid]          || { hotSpots: [] };
    scenes[sid].title    = title;
    scenes[sid].panorama = panorama;
  }

  try {
    const r = await fetch('/api/scenes', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        id: sid, title, panorama,
        hotSpots: (sid ? scenes[sid]?.hotSpots : []) || []
      })
    });
    const j = await r.json();
    if (!j.success) throw new Error('Server returned failure');

    currentScene = j.id;
    if (notify) toast('Scene saved ✓', 'success');
    await loadScenes();
    // Re-init viewer to reflect latest state (including new hotspot arrows)
    if (scenes[currentScene]?.panorama) initViewer(scenes[currentScene]);
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  }
}

async function confirmDeleteScene(id) {
  const name = scenes[id]?.title || id;
  if (!confirm(`Delete scene "${name}"?\n\nAll hotspots linked to this scene will also be removed.`)) return;
  try {
    const r = await fetch('/api/scenes/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!(await r.json()).success) throw new Error('Delete failed on server');
    if (currentScene === id) {
      currentScene = null;
      document.getElementById('sceneId').value    = '';
      document.getElementById('sceneTitle').value = '';
      document.getElementById('sceneImage').value = '';
      document.getElementById('hotspotList').innerHTML = '';
      clearViewer();
    }
    toast('Scene deleted', 'success');
    await loadScenes();
  } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
}

document.getElementById('btnDeleteScene').onclick = () => {
  if (!currentScene) { toast('No scene selected', 'error'); return; }
  confirmDeleteScene(currentScene);
};

/* ────────────────────────────────────────
   NEW SCENE
──────────────────────────────────────── */
document.getElementById('btnNewScene').onclick = () => {
  currentScene = null;
  document.getElementById('sceneId').value    = '(auto)';
  document.getElementById('sceneTitle').value = '';
  document.getElementById('sceneImage').value = '';
  document.getElementById('hotspotList').innerHTML = '';
  clearViewer('Fill in title & image path, then Save.');
  renderSceneList();
};

/* ────────────────────────────────────────
   UPLOAD  (with drag-and-drop)
──────────────────────────────────────── */
document.getElementById('btnUpload').onclick     = () => doUpload(false);
document.getElementById('btnAutoCreate').onclick = () => doUpload(true);

/* Drag-and-drop on the upload card */
const uploadCard = document.getElementById('fileInput').closest('.card') || document.body;
uploadCard.addEventListener('dragover',  e => { e.preventDefault(); e.currentTarget.style.outline = '2.5px dashed #007aff'; });
uploadCard.addEventListener('dragleave', e => { e.currentTarget.style.outline = ''; });
uploadCard.addEventListener('drop', e => {
  e.preventDefault();
  e.currentTarget.style.outline = '';
  const dt = e.dataTransfer;
  if (dt?.files?.length) {
    Object.defineProperty(document.getElementById('fileInput'), 'files', { value: dt.files, configurable: true });
    setUpMsg(`${dt.files.length} file(s) ready`);
  }
});

document.getElementById('fileInput').addEventListener('change', () => {
  const n = document.getElementById('fileInput').files.length;
  if (n) setUpMsg(`${n} file(s) selected`);
});

async function doUpload(autoCreate) {
  const files = document.getElementById('fileInput').files;
  if (!files.length) { toast('Select or drag image files first', 'error'); return; }

  setUpMsg(`⏳ Uploading ${files.length} file(s)…`);
  document.getElementById('btnUpload').disabled     = true;
  document.getElementById('btnAutoCreate').disabled = true;

  const fd = new FormData();
  for (const f of files) fd.append('images', f);

  try {
    const r    = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await r.json();
    if (!data.success) throw new Error(data.error || 'Upload failed');

    const paths = data.files || [data.path];
    setUpMsg(`✅ Uploaded ${paths.length} file(s)`);
    setTimeout(() => setUpMsg(''), 5000);

    if (autoCreate) {
      for (const p of paths) {
        const sid   = 'scene' + Date.now() + Math.random().toString(36).slice(2, 5);
        const rawN  = p.split('/').pop().replace(/\.[^.]+$/, '');
        const title = rawN.replace(/^\d+[_\-\s]?/, '').replace(/[_\-]/g, ' ').trim() || rawN || 'Scene';
        await fetch('/api/scenes', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ id: sid, title, panorama: p, hotSpots: [] })
        });
      }
      toast(`✅ Created ${paths.length} scene(s)`, 'success');
      await loadScenes();
      const all = Object.keys(scenes);
      if (all.length) selectScene(all[all.length - 1]);
    } else {
      document.getElementById('sceneImage').value = paths[0];
      toast('Path filled in — set a title and Save', 'success');
    }
    document.getElementById('fileInput').value = '';
  } catch (e) {
    toast('Upload error: ' + e.message, 'error');
    setUpMsg('');
  } finally {
    document.getElementById('btnUpload').disabled     = false;
    document.getElementById('btnAutoCreate').disabled = false;
  }
}

function setUpMsg(msg) {
  const el = document.getElementById('uploadMsg');
  if (el) el.textContent = msg;
}

/* ────────────────────────────────────────
   STATS & USERS
──────────────────────────────────────── */
document.getElementById('btnReloadStats').onclick = loadStats;

async function loadStats() {
  try {
    const [sr, ur] = await Promise.all([fetch('/api/stats'), fetch('/api/users')]);
    const stats = sr.ok ? await sr.json() : {};
    const users = ur.ok ? await ur.json() : [];

    /* Stat boxes */
    document.getElementById('statGrid').innerHTML = `
      <div class="stat-box">
        <div class="num">${stats.scenes      ?? 0}</div>
        <div class="lbl">Scenes</div>
      </div>
      <div class="stat-box">
        <div class="num">${stats.users       ?? 0}</div>
        <div class="lbl">Users</div>
      </div>
      <div class="stat-box">
        <div class="num">${stats.uploads     ?? 0}</div>
        <div class="lbl">Files</div>
      </div>
      <div class="stat-box">
        <div class="num">${stats.todayVisits ?? 0}</div>
        <div class="lbl">Today</div>
      </div>`;

    /* User list */
    const ul = document.getElementById('userList');
    if (!users.length) {
      ul.innerHTML = '<p class="small">No users found.</p>';
    } else {
      ul.innerHTML = users.slice(0, 10).map((u, i) => `
        <div class="user-row" style="animation-delay:${i * 22}ms">
          <div class="uav">${esc((u.username || u.email || '?')[0].toUpperCase())}</div>
          <div class="uinfo">
            <div class="uname">${esc(u.username || '—')}</div>
            <div class="uemail">${esc(u.email)}</div>
          </div>
          <span class="badge badge-${esc(u.role)}">${esc(u.role)}</span>
        </div>`).join('');
    }

    drawChart(stats.visits || []);
  } catch (e) {
    console.warn('Stats failed:', e);
  }
}

/* ────────────────────────────────────────
   CHART  (HiDPI canvas, no external deps)
──────────────────────────────────────── */
function drawChart(visits) {
  const canvas = document.getElementById('statsChart');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 580;
  const H   = 200;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  if (!visits.length) {
    ctx.fillStyle = '#aaa';
    ctx.font      = '13px Inter,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No visit data yet — share the tour with users!', W / 2, H / 2);
    return;
  }

  const max  = Math.max(...visits.map(v => v.count), 1);
  const pad  = 34;
  const colW = (W - pad * 2) / visits.length;
  const bw   = Math.max(10, colW * 0.52);

  visits.forEach((v, i) => {
    const bh  = Math.max(3, ((v.count / max) * (H - 50)));
    const x   = pad + i * colW + (colW - bw) / 2;
    const y   = H - 30 - bh;
    const lbl = (scenes[v.sceneId]?.title || v.sceneId || '?').slice(0, 12);

    /* Bar gradient */
    const g = ctx.createLinearGradient(0, y, 0, H - 30);
    g.addColorStop(0, '#007aff');
    g.addColorStop(1, 'rgba(0,122,255,.18)');
    ctx.fillStyle = g;
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(x, y, bw, bh, [4, 4, 0, 0]); ctx.fill();
    } else {
      ctx.fillRect(x, y, bw, bh);
    }

    /* Count label */
    ctx.fillStyle  = '#007aff';
    ctx.font       = `bold ${Math.min(11, Math.floor(colW * 0.36))}px Inter,sans-serif`;
    ctx.textAlign  = 'center';
    ctx.fillText(v.count, x + bw / 2, Math.max(10, y - 5));

    /* Scene label */
    ctx.fillStyle = '#8a94a6';
    ctx.font      = `${Math.min(10, Math.floor(colW * 0.3))}px Inter,sans-serif`;
    ctx.fillText(lbl, x + bw / 2, H - 10);
  });
}

/* ────────────────────────────────────────
   FULLSCREEN (admin viewer)
──────────────────────────────────────── */
document.getElementById('btnFullscreen').onclick = () => {
  const c = document.getElementById('adminViewer');
  if (!document.fullscreenElement && !document.webkitFullscreenElement) {
    const fn = c.requestFullscreen || c.webkitRequestFullscreen;
    if (fn) fn.call(c).catch(() => toggleExpand(c));
    else    toggleExpand(c);
  } else {
    const fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (fn) fn.call(document);
  }
};

function toggleExpand(c) {
  c.style.height = (c.style.height === '85vh') ? '500px' : '85vh';
  window.dispatchEvent(new Event('resize'));
}

['fullscreenchange', 'webkitfullscreenchange'].forEach(ev =>
  document.addEventListener(ev, () =>
    setTimeout(() => window.dispatchEvent(new Event('resize')), 140)));

/* ────────────────────────────────────────
   LOGOUT
──────────────────────────────────────── */
document.getElementById('btnLogout').onclick = async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login.html';
};

/* ────────────────────────────────────────
   TOAST NOTIFICATIONS
──────────────────────────────────────── */
function toast(msg, type = '') {
  document.querySelectorAll('.toast').forEach(t => { t.classList.add('out'); setTimeout(() => t.remove(), 300); });
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 350);
  }, 3200);
}

/* ────────────────────────────────────────
   UTILS
──────────────────────────────────────── */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
