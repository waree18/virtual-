(async function() {
  try {
    const res = await fetch('/api/export');
    const scenes = await res.json();
    const ids = Object.keys(scenes);
    if (ids.length === 0) {
      document.getElementById('titleBar').innerText = 'No scenes';
      return;
    }

    const viewer = pannellum.viewer('viewer', {
      default: {
        firstScene: ids[0],
        sceneFadeDuration: 400,
        autoLoad: true
      },
      scenes: scenes,
      orientationOnByDefault: true
    });

    // ── VR state ──
    let vrMode = false;
    let vrRAF  = null;      // requestAnimationFrame handle
    let vrCanvas = null;    // overlay <canvas>
    let vrCtx    = null;    // 2d context of overlay

    function updateTitle(sceneId) {
      document.getElementById('titleBar').innerText = scenes[sceneId]?.title || sceneId;
      fetch('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId })
      });
    }

    viewer.on('scenechange', (sceneId) => updateTitle(sceneId));
    updateTitle(ids[0]);

    // ── Navigation ──
    document.getElementById('prevBtn').onclick = () => {
      const cur = viewer.getScene();
      const i = ids.indexOf(cur);
      viewer.loadScene(ids[(i - 1 + ids.length) % ids.length]);
    };
    document.getElementById('nextBtn').onclick = () => {
      const cur = viewer.getScene();
      const i = ids.indexOf(cur);
      viewer.loadScene(ids[(i + 1) % ids.length]);
    };

    // ── Fullscreen ──
    const fsBtn = document.getElementById('fsBtn');
    if (fsBtn) {
      fsBtn.onclick = () => {
        viewer.isFullscreen() ? viewer.exitFullscreen() : viewer.toggleFullscreen();
      };
    }

    // ══════════════════════════════════════════════
    //  REAL VR STEREO  –  works in Chrome on Android
    //  Strategy: grab Pannellum's internal WebGL
    //  canvas via querySelector, then each frame
    //  blit it into the LEFT half, and blit again
    //  (with a tiny yaw offset) into the RIGHT half.
    //  This gives true side-by-side stereo without
    //  any extra library.
    // ══════════════════════════════════════════════

    function getPannellumCanvas() {
      // Pannellum renders into a <canvas> inside #viewer
      return document.querySelector('#viewer canvas');
    }

    function createVrOverlay() {
      const c = document.createElement('canvas');
      c.id = 'vrOverlay';
      c.style.cssText = [
        'position:fixed', 'top:0', 'left:0',
        'width:100vw', 'height:100vh',
        'z-index:9999', 'display:block',
        'background:#000', 'touch-action:none'
      ].join(';');
      c.width  = screen.width  || window.innerWidth;
      c.height = screen.height || window.innerHeight;
      document.body.appendChild(c);
      return c;
    }

    // IPD offset in degrees – how much each eye is rotated
    const EYE_YAW_OFFSET = 1.8;

    function vrRenderLoop() {
      if (!vrMode || !vrCanvas || !vrCtx) return;

      const src = getPannellumCanvas();
      if (!src || src.width === 0) {
        vrRAF = requestAnimationFrame(vrRenderLoop);
        return;
      }

      const W = vrCanvas.width;
      const H = vrCanvas.height;
      const halfW = W / 2;

      vrCtx.clearRect(0, 0, W, H);

      // ── LEFT EYE ──
      // Shift pannellum yaw slightly left, grab frame, draw to left half
      try { viewer.setYaw(viewer.getYaw() - EYE_YAW_OFFSET); } catch(_){}
      vrCtx.drawImage(src, 0, 0, halfW, H);

      // ── RIGHT EYE ──
      // Shift pannellum yaw slightly right, grab frame, draw to right half
      try { viewer.setYaw(viewer.getYaw() + EYE_YAW_OFFSET * 2); } catch(_){}
      vrCtx.drawImage(src, halfW, 0, halfW, H);

      // Restore yaw to center between the two eye positions
      try { viewer.setYaw(viewer.getYaw() - EYE_YAW_OFFSET); } catch(_){}

      // ── Divider line ──
      vrCtx.strokeStyle = 'rgba(255,255,255,0.25)';
      vrCtx.lineWidth   = 2;
      vrCtx.beginPath();
      vrCtx.moveTo(halfW, 0);
      vrCtx.lineTo(halfW, H);
      vrCtx.stroke();

      vrRAF = requestAnimationFrame(vrRenderLoop);
    }

    // Device-orientation → Pannellum yaw/pitch
    function handleDeviceOrientation(e) {
      if (!vrMode) return;
      if (e.beta === null) return;

      // Portrait-held-upright orientation mapping for Cardboard
      const yaw   =  e.alpha;          // compass heading  → yaw
      const pitch = (e.beta  - 90);    // tilted up = looking up

      try {
        viewer.setYaw(yaw);
        viewer.setPitch(Math.max(-85, Math.min(85, pitch)));
      } catch(_){}
    }

    async function enableVRMode() {
      if (vrMode) return;

      // 1. Request gyro permission on iOS 13+
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const perm = await DeviceOrientationEvent.requestPermission();
          if (perm !== 'granted') {
            alert('Motion sensor permission is required for VR mode.');
            return;
          }
        } catch (err) {
          console.warn('Orientation permission error:', err);
        }
      }

      vrMode = true;

      // 2. Hide UI chrome
      ['titleBar','prevBtn','nextBtn','vrBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      // 3. Go fullscreen + lock landscape
      try {
        const el = document.documentElement;
        if (el.requestFullscreen)            await el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      } catch(_){}
      try { await screen.orientation.lock('landscape'); } catch(_){}

      // 4. Create overlay canvas
      vrCanvas = createVrOverlay();
      vrCtx    = vrCanvas.getContext('2d');

      // 5. Turn on gyro
      window.addEventListener('deviceorientation', handleDeviceOrientation, true);

      // 6. Start render loop
      vrRenderLoop();

      // 7. Tap anywhere on overlay → exit VR
      vrCanvas.addEventListener('click', disableVRMode, { once: true });

      console.log('✅ VR Mode enabled');
    }

    function disableVRMode() {
      if (!vrMode) return;
      vrMode = false;

      // Stop render loop
      if (vrRAF) { cancelAnimationFrame(vrRAF); vrRAF = null; }

      // Remove overlay
      if (vrCanvas && vrCanvas.parentNode) vrCanvas.parentNode.removeChild(vrCanvas);
      vrCanvas = null; vrCtx = null;

      // Remove gyro
      window.removeEventListener('deviceorientation', handleDeviceOrientation, true);

      // Restore UI
      ['titleBar','prevBtn','nextBtn','vrBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });

      // Exit fullscreen
      try {
        if (document.exitFullscreen)            document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } catch(_){}
      try { screen.orientation.unlock(); } catch(_){}

      console.log('✅ VR Mode disabled');
    }

    // ── VR Button ──
    const vrBtn = document.getElementById('vrBtn');
    if (vrBtn) {
      vrBtn.onclick = () => vrMode ? disableVRMode() : enableVRMode();
    }

    // ── Keep overlay canvas sized to screen ──
    window.addEventListener('resize', () => {
      if (vrCanvas) {
        vrCanvas.width  = window.innerWidth;
        vrCanvas.height = window.innerHeight;
      }
    });

  } catch (e) {
    console.error('Initialization Error:', e);
  }
})();