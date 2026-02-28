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
      orientationOnByDefault: true // เปิดใช้งาน Gyroscope เตรียมไว้
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

    // ปุ่ม Next / Prev
    document.getElementById('prevBtn').onclick = () => {
      const cur = viewer.getScene(); const i = ids.indexOf(cur);
      viewer.loadScene(ids[(i - 1 + ids.length) % ids.length]);
    };
    document.getElementById('nextBtn').onclick = () => {
      const cur = viewer.getScene(); const i = ids.indexOf(cur);
      viewer.loadScene(ids[(i + 1) % ids.length]);
    };

    // ==========================================
    // แยกปุ่ม Fullscreen และ VR ให้ทำงานอิสระ
    // ==========================================

    // 1. ปุ่ม Fullscreen (id="fsBtn")
    const fsBtn = document.getElementById('fsBtn');
    if (fsBtn) {
      fsBtn.onclick = () => {
        if (viewer.isFullscreen()) viewer.exitFullscreen();
        else viewer.toggleFullscreen();
      };
    }

    // 2. ปุ่ม VR (id="vrBtn") - พร้อมขอสิทธิ์เซนเซอร์
    const vrBtn = document.getElementById('vrBtn');
    if (vrBtn) {
      vrBtn.onclick = () => {
        // กรณี iOS 13+ หรือเบราว์เซอร์ที่ต้องขอสิทธิ์ Motion Sensor
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
          DeviceOrientationEvent.requestPermission()
            .then(response => {
              if (response == 'granted') {
                enableVRMode();
              } else {
                alert("กรุณาอนุญาตการเข้าถึง Motion Sensor เพื่อใช้งาน VR");
              }
            })
            .catch(console.error);
        } else {
          // สำหรับ Android ทั่วไป
          enableVRMode();
        }
      };
    }

    function enableVRMode() {
      try {
        viewer.toggleStereo(); // แยก 2 หน้าจอ
        if (!viewer.isFullscreen()) {
          viewer.toggleFullscreen(); // เข้าโหมดเต็มจอปิดแถบ URL
        }
      } catch (err) {
        alert("ไม่รองรับการแสดงผล VR บนอุปกรณ์นี้");
      }
    }

  } catch (e) {
    console.error("Initialization Error:", e);
  }
})();