(async function() {
  try {
    const res = await fetch('/api/export');
    const scenes = await res.json();
    const ids = Object.keys(scenes);
    if (ids.length === 0) {
      document.getElementById('titleBar').innerText = 'No scenes';
      return;
    }

    // ── Main viewer ──
    const viewer = pannellum.viewer('viewer', {
      default: { firstScene: ids[0], sceneFadeDuration: 400, autoLoad: true },
      scenes,
      orientationOnByDefault: false
    });

    let vrMode = false;
    let vrLeft = null;      // pannellum instance – left eye
    let vrRight = null;     // pannellum instance – right eye
    let vrSyncTimer = null;
    let vrContainer = null;
    let gyroHandler = null;

    function updateTitle(sceneId) {
      document.getElementById('titleBar').innerText = scenes[sceneId]?.title || sceneId;
      fetch('/api/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sceneId })
      });
    }
    viewer.on('scenechange', updateTitle);
    updateTitle(ids[0]);

    // ── Nav buttons ──
    document.getElementById('prevBtn').onclick = () => {
      const i = ids.indexOf(viewer.getScene());
      viewer.loadScene(ids[(i - 1 + ids.length) % ids.length]);
    };
    document.getElementById('nextBtn').onclick = () => {
      const i = ids.indexOf(viewer.getScene());
      viewer.loadScene(ids[(i + 1) % ids.length]);
    };
    const fsBtn = document.getElementById('fsBtn');
    if (fsBtn) fsBtn.onclick = () =>
      viewer.isFullscreen() ? viewer.exitFullscreen() : viewer.toggleFullscreen();

    // ════════════════════════════════════════════════
    //  VR STEREO  –  Two real Pannellum instances
    //
    //  WHY: Pannellum uses WebGL with preserveDrawingBuffer=false.
    //  drawImage() on a WebGL canvas always produces a blank frame
    //  because the buffer is cleared immediately after each draw.
    //  The ONLY working approach is two separate Pannellum viewers
    //  side by side, both driven by the gyroscope.
    // ════════════════════════════════════════════════

    const IPD_YAW = 1.8; // degrees of yaw separation for stereo depth

    function getCurrentSceneConfig() {
      const sceneId = viewer.getScene() || ids[0];
      const s = scenes[sceneId] || scenes[ids[0]];
      return {
        type: 'equirectangular',
        panorama: s.panorama,
        autoLoad: true,
        showControls: false,
        compass: false,
        pitch: (() => { try { return viewer.getPitch(); } catch(_){ return 0; } })(),
        yaw:   (() => { try { return viewer.getYaw();   } catch(_){ return 0; } })(),
        hfov:  (() => { try { return viewer.getHfov();  } catch(_){ return 100; } })()
      };
    }

    async function enableVRMode() {
      if (vrMode) return;

      // 1. iOS 13+ gyro permission (must be triggered by user gesture)
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const p = await DeviceOrientationEvent.requestPermission();
          if (p !== 'granted') {
            alert('Motion sensor permission is required for VR mode.');
            return;
          }
        } catch(e) { console.warn('Orientation permission:', e); }
      }

      vrMode = true;

      // 2. Hide main UI
      ['titleBar','prevBtn','nextBtn','vrBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      document.getElementById('viewer').style.visibility = 'hidden';

      // 3. Build split-screen VR container
      vrContainer = document.createElement('div');
      vrContainer.id = 'vrContainer';
      Object.assign(vrContainer.style, {
        position: 'fixed', inset: '0', zIndex: '9000',
        display: 'flex', background: '#000', overflow: 'hidden'
      });

      const leftDiv  = document.createElement('div');
      const rightDiv = document.createElement('div');
      [leftDiv, rightDiv].forEach(d => {
        Object.assign(d.style, {
          width: '50%', height: '100%',
          position: 'relative', overflow: 'hidden', flexShrink: '0'
        });
      });

      // Nose bridge divider
      const divider = document.createElement('div');
      Object.assign(divider.style, {
        position: 'absolute', left: '50%', top: '0', bottom: '0',
        width: '4px', background: '#000',
        transform: 'translateX(-50%)', zIndex: '9002', pointerEvents: 'none'
      });

      // Tap-to-exit button
      const exitBtn = document.createElement('button');
      exitBtn.textContent = '✕ Exit VR';
      Object.assign(exitBtn.style, {
        position: 'absolute', bottom: '18px', left: '50%',
        transform: 'translateX(-50%)', zIndex: '9003',
        padding: '10px 24px', background: 'rgba(0,0,0,0.65)',
        color: '#fff', border: '1.5px solid rgba(255,255,255,0.35)',
        borderRadius: '30px', fontSize: '14px', fontWeight: '700',
        cursor: 'pointer', fontFamily: 'inherit'
      });
      exitBtn.addEventListener('click', disableVRMode);

      vrContainer.appendChild(leftDiv);
      vrContainer.appendChild(rightDiv);
      vrContainer.appendChild(divider);
      vrContainer.appendChild(exitBtn);
      document.body.appendChild(vrContainer);

      // 4. Init two Pannellum instances with IPD yaw offset
      const cfg = getCurrentSceneConfig();

      vrLeft = pannellum.viewer(leftDiv, {
        ...cfg,
        yaw: cfg.yaw - IPD_YAW,
        orientationOnByDefault: false
      });

      vrRight = pannellum.viewer(rightDiv, {
        ...cfg,
        yaw: cfg.yaw + IPD_YAW,
        orientationOnByDefault: false
      });

      // 5. Gyroscope handler
      let targetYaw   = cfg.yaw;
      let targetPitch = cfg.pitch;

      gyroHandler = (e) => {
        if (!vrMode || e.alpha === null) return;
        const angle = screen.orientation?.angle ?? window.orientation ?? 0;

        if (Math.abs(angle) === 90) {
          // Landscape – standard Cardboard orientation
          targetYaw   =  (e.alpha || 0);
          targetPitch = -(e.gamma || 0);
        } else {
          // Portrait fallback
          targetYaw   =  (e.alpha || 0);
          targetPitch =  (e.beta  || 0) - 90;
        }
        targetPitch = Math.max(-85, Math.min(85, targetPitch));
      };

      window.addEventListener('deviceorientation', gyroHandler, true);

      // 6. Sync both viewers to gyro at ~60fps
      vrSyncTimer = setInterval(() => {
        if (!vrMode) return;
        try { vrLeft.setPitch(targetPitch);  vrLeft.setYaw(targetYaw - IPD_YAW);  } catch(_){}
        try { vrRight.setPitch(targetPitch); vrRight.setYaw(targetYaw + IPD_YAW); } catch(_){}
      }, 16);

      // 7. Fullscreen + landscape lock
      try {
        const root = document.documentElement;
        if (root.requestFullscreen)            await root.requestFullscreen();
        else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
      } catch(_){}
      try { await screen.orientation.lock('landscape'); } catch(_){}

      console.log('✅ VR Mode enabled');
    }

    function disableVRMode() {
      if (!vrMode) return;
      vrMode = false;

      if (vrSyncTimer) { clearInterval(vrSyncTimer); vrSyncTimer = null; }
      if (gyroHandler) { window.removeEventListener('deviceorientation', gyroHandler, true); gyroHandler = null; }

      try { if (vrLeft)  vrLeft.destroy();  vrLeft  = null; } catch(_){}
      try { if (vrRight) vrRight.destroy(); vrRight = null; } catch(_){}

      if (vrContainer) { vrContainer.remove(); vrContainer = null; }

      document.getElementById('viewer').style.visibility = '';
      ['titleBar','prevBtn','nextBtn','vrBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });

      try {
        if (document.exitFullscreen)            document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } catch(_){}
      try { screen.orientation.unlock(); } catch(_){}

      console.log('✅ VR Mode disabled');
    }

    // ── VR Button ──
    const vrBtn = document.getElementById('vrBtn');
    if (vrBtn) vrBtn.onclick = () => vrMode ? disableVRMode() : enableVRMode();

    // ── Scene change: update both VR viewers ──
    viewer.on('scenechange', (sceneId) => {
      if (!vrMode) return;
      const s = scenes[sceneId];
      if (!s) return;
      try { vrLeft.loadPanorama(s.panorama);  } catch(_){}
      try { vrRight.loadPanorama(s.panorama); } catch(_){}
    });

    window.addEventListener('resize', () => {
      if (!vrMode) return;
      try { vrLeft?.resize();  } catch(_){}
      try { vrRight?.resize(); } catch(_){}
    });

  } catch (e) {
    console.error('Initialization Error:', e);
  }
})();