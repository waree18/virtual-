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
      orientationOnByDefault: true // ให้หมุนตามมือถืออัตโนมัติ
    });

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

    // ปุ่มนำทาง
    document.getElementById('prevBtn').onclick = () => {
      const cur = viewer.getScene(); const i = ids.indexOf(cur);
      viewer.loadScene(ids[(i - 1 + ids.length) % ids.length]);
    };
    document.getElementById('nextBtn').onclick = () => {
      const cur = viewer.getScene(); const i = ids.indexOf(cur);
      viewer.loadScene(ids[(i + 1) % ids.length]);
    };

    // ==========================================
    // แยกปุ่ม Fullscreen และ VR ให้ชัดเจน
    // ==========================================

    // ปุ่ม Fullscreen (id="fsBtn")
    const fsBtn = document.getElementById('fsBtn');
    if (fsBtn) {
      fsBtn.onclick = () => {
        if (viewer.isFullscreen()) viewer.exitFullscreen();
        else viewer.toggleFullscreen();
      };
    }

    // ปุ่ม VR (id="vrBtn")
    const vrBtn = document.getElementById('vrBtn');
    if (vrBtn) {
      vrBtn.onclick = () => {
        // ขออนุญาตเข้าถึงเซนเซอร์ (รองรับทั้ง iOS และ Android รุ่นใหม่)
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
          DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
              if (permissionState === 'granted') {
                startVR();
              } else {
                alert("กรุณาอนุญาตการเข้าถึง Motion Sensor เพื่อใช้โหมด VR");
              }
            })
            .catch(console.error);
        } else {
          // สำหรับเบราว์เซอร์ที่ไม่ต้องขอ Permission (Android ส่วนใหญ่)
          startVR();
        }
      };
    }

    function startVR() {
      try {
        viewer.toggleStereo(); // แยกหน้าจอ
        if (!viewer.isFullscreen()) viewer.toggleFullscreen(); // ขยายเต็มจอ
      } catch (e) {
        alert("เบราว์เซอร์ของคุณไม่รองรับโหมด VR หรือไม่ได้รันบน HTTPS");
      }
    }

  } catch (e) {
    console.error("Error loading scenes:", e);
  }
})();