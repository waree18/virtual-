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
      orientationOnByDefault: true // เปิดระบบหมุนตามมือถือไว้รอเลย
    });

    function updateTitle(sceneId) {
      document.getElementById('titleBar').innerText = scenes[sceneId]?.title || sceneId;
      fetch('/api/visit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          sceneId
        })
      });
    }

    viewer.on('scenechange', function(sceneId) {
      updateTitle(sceneId);
    });

    updateTitle(ids[0]);

    const nav = document.getElementById('panoNav');
    ids.forEach((id, i) => {
      const btn = document.createElement('button');
      btn.innerText = i + 1;
      btn.onclick = () => viewer.loadScene(id);
      nav.appendChild(btn);
    });

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

    // ==========================================
    // ส่วนที่แก้ไข: แยกปุ่ม Fullscreen และ VR
    // ==========================================

    // 1. สำหรับปุ่ม Fullscreen (เน้นขยายจอ ไม่แยกภาพ)
    // ตรวจสอบว่าใน HTML มี id="fsBtn" หรือไม่
    const fsBtn = document.getElementById('fsBtn');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        if (viewer.isFullscreen()) {
          viewer.exitFullscreen();
        } else {
          viewer.toggleFullscreen();
        }
      });
    }

    // 2. สำหรับปุ่ม VR (เน้นแยก 2 หน้าจอ Split Screen)
    // ใช้ id="vrBtn" ตามโค้ดเดิมของคุณ
    document.getElementById('vrBtn').addEventListener('click', () => {
      // สั่งแยกหน้าจอ
      viewer.toggleStereo();

      // สั่งให้เต็มจอด้วยเพื่อให้เข้าโหมด VR สมบูรณ์แบบ
      if (!viewer.isFullscreen()) {
        viewer.toggleFullscreen();
      }
    });

  } catch (e) {
    console.error(e);
  }
})();