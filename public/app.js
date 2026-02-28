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

    // VR State tracking
    let vrMode = false;
    let stereoCanvas = null;
    let stereoContext = null;

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

    // ===== Navigation Buttons =====
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

    // ===== Fullscreen Button =====
    const fsBtn = document.getElementById('fsBtn');
    if (fsBtn) {
      fsBtn.onclick = () => {
        if (viewer.isFullscreen()) {
          viewer.exitFullscreen();
        } else {
          viewer.toggleFullscreen();
        }
      };
    }

    // ===== VR Split-Screen Implementation =====
    function createStereoCanvas() {
      // Create a container for stereo view
      const container = document.getElementById('viewer');
      const originalDisplay = container.style.display;
      
      // Create stereo canvas
      const canvas = document.createElement('canvas');
      canvas.id = 'stereoCanvas';
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      canvas.style.display = 'block';
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.zIndex = '999';
      
      document.body.appendChild(canvas);
      
      return canvas;
    }

    function removeStereoCanvas() {
      if (stereoCanvas && stereoCanvas.parentNode) {
        stereoCanvas.parentNode.removeChild(stereoCanvas);
        stereoCanvas = null;
        stereoContext = null;
      }
    }

    function renderStereoView() {
      if (!stereoCanvas || !stereoContext) return;

      const width = stereoCanvas.width;
      const height = stereoCanvas.height;
      const eyeSeparation = 8; // Distance between eyes (pixels)

      // Clear canvas
      stereoContext.fillStyle = '#000';
      stereoContext.fillRect(0, 0, width, height);

      // Get current viewer state
      const pitch = viewer.getPitch();
      const yaw = viewer.getYaw();
      const fov = viewer.getHfov();

      // Left eye (slight offset left)
      stereoContext.save();
      stereoContext.translate(-eyeSeparation, 0);
      stereoContext.fillStyle = '#00FF00';
      stereoContext.font = '14px Arial';
      stereoContext.fillText('L', 20, 30);
      stereoContext.restore();

      // Right eye (slight offset right)
      stereoContext.save();
      stereoContext.translate(eyeSeparation, 0);
      stereoContext.fillStyle = '#FF0000';
      stereoContext.font = '14px Arial';
      stereoContext.fillText('R', width - 40, 30);
      stereoContext.restore();

      // Draw center line divider
      stereoContext.strokeStyle = 'rgba(255,255,255,0.3)';
      stereoContext.lineWidth = 2;
      stereoContext.beginPath();
      stereoContext.moveTo(width / 2, 0);
      stereoContext.lineTo(width / 2, height);
      stereoContext.stroke();

      // Continue rendering loop
      requestAnimationFrame(renderStereoView);
    }

    function enableVRMode() {
      if (vrMode) return; // Already in VR mode

      try {
        // Hide the title bar
        const titleBar = document.getElementById('titleBar');
        if (titleBar) titleBar.style.display = 'none';

        // Hide navigation buttons
        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        if (prevBtn) prevBtn.style.display = 'none';
        if (nextBtn) nextBtn.style.display = 'none';

        // Enter fullscreen
        if (!viewer.isFullscreen()) {
          viewer.toggleFullscreen();
        }

        // Create stereo canvas overlay
        stereoCanvas = createStereoCanvas();
        stereoContext = stereoCanvas.getContext('2d');

        // Request device orientation permission (iOS 13+)
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
          DeviceOrientationEvent.requestPermission()
            .then(response => {
              if (response === 'granted') {
                console.log('✅ Motion Sensor permission granted');
                window.addEventListener('deviceorientation', handleDeviceOrientation);
              }
            })
            .catch(err => {
              console.warn('Motion Sensor permission denied:', err);
              // Continue anyway on Android
              window.addEventListener('deviceorientation', handleDeviceOrientation);
            });
        } else {
          // Android doesn't require explicit permission
          window.addEventListener('deviceorientation', handleDeviceOrientation);
        }

        // Start rendering stereo view
        renderStereoView();

        vrMode = true;
        console.log('✅ VR Mode Enabled');

      } catch (err) {
        console.error('VR Mode Error:', err);
        alert('VR mode is not supported on this device');
        removeStereoCanvas();
        vrMode = false;
      }
    }

    function disableVRMode() {
      if (!vrMode) return;

      try {
        // Show UI elements again
        const titleBar = document.getElementById('titleBar');
        if (titleBar) titleBar.style.display = 'block';

        const prevBtn = document.getElementById('prevBtn');
        const nextBtn = document.getElementById('nextBtn');
        if (prevBtn) prevBtn.style.display = 'block';
        if (nextBtn) nextBtn.style.display = 'block';

        // Exit fullscreen
        if (viewer.isFullscreen()) {
          viewer.exitFullscreen();
        }

        // Remove stereo overlay
        removeStereoCanvas();

        // Remove device orientation listener
        window.removeEventListener('deviceorientation', handleDeviceOrientation);

        vrMode = false;
        console.log('✅ VR Mode Disabled');

      } catch (err) {
        console.error('Error disabling VR mode:', err);
      }
    }

    function handleDeviceOrientation(event) {
      if (!vrMode) return;

      const alpha = event.alpha; // Z axis rotation (0-360)
      const beta = event.beta;   // X axis rotation (-180 to 180)
      const gamma = event.gamma; // Y axis rotation (-90 to 90)

      // Convert device orientation to viewer yaw/pitch
      // This is a basic implementation - adjust based on your needs
      const yaw = alpha;
      const pitch = beta - 90; // Adjust offset as needed

      // Update viewer orientation
      viewer.setYaw(yaw);
      viewer.setPitch(pitch);
    }

    // ===== VR Button Handler =====
    const vrBtn = document.getElementById('vrBtn');
    if (vrBtn) {
      vrBtn.onclick = () => {
        if (!vrMode) {
          // Entering VR mode
          if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS 13+ requires permission request
            DeviceOrientationEvent.requestPermission()
              .then(response => {
                if (response === 'granted') {
                  enableVRMode();
                } else {
                  alert('Motion Sensor permission required for VR mode');
                }
              })
              .catch(err => {
                console.warn('Permission request error:', err);
                // Try to enable anyway
                enableVRMode();
              });
          } else {
            // Android and other devices
            enableVRMode();
          }
        } else {
          // Exiting VR mode
          disableVRMode();
        }
      };
    }

    // Handle window resize in VR mode
    window.addEventListener('resize', () => {
      if (stereoCanvas) {
        stereoCanvas.width = window.innerWidth;
        stereoCanvas.height = window.innerHeight;
      }
    });

  } catch (e) {
    console.error('Initialization Error:', e);
  }
})();
