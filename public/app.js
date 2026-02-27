(async function(){
  try{
    const res = await fetch('/api/export');
    const scenes = await res.json();
    const ids = Object.keys(scenes);
    if(ids.length === 0) {
      document.getElementById('titleBar').innerText = 'No scenes';
      return;
    }

    const viewer = pannellum.viewer('viewer', {
      default: { firstScene: ids[0], sceneFadeDuration: 400, autoLoad: true },
      scenes: scenes,
      orientationOnByDefault: true
    });

    function updateTitle(sceneId){
      document.getElementById('titleBar').innerText = scenes[sceneId]?.title || sceneId;
      // post visit
      fetch('/api/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sceneId})});
    }

    // Ensure change on hotspot navigation
    viewer.on('scenechange', function(sceneId){
      updateTitle(sceneId);
    });

    // initial
    updateTitle(ids[0]);

    // build nav
    const nav = document.getElementById('panoNav');
    ids.forEach((id, i) => {
      const btn = document.createElement('button');
      btn.innerText = i+1;
      btn.onclick = ()=> viewer.loadScene(id);
      nav.appendChild(btn);
    });

    document.getElementById('prevBtn').onclick = ()=> {
      const cur = viewer.getScene(); const i = ids.indexOf(cur);
      viewer.loadScene(ids[(i-1+ids.length)%ids.length]);
    };
    document.getElementById('nextBtn').onclick = ()=> {
      const cur = viewer.getScene(); const i = ids.indexOf(cur);
      viewer.loadScene(ids[(i+1)%ids.length]);
    };

    // VR button
    document.getElementById('vrBtn').addEventListener('click', ()=>{
      if (viewer.isFullscreen()) viewer.exitFullscreen();
      else viewer.toggleFullscreen();
    });

  }catch(e){
    console.error(e);
    document.getElementById('titleBar').innerText = 'Load error';
  }
})();