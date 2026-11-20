/* GTA // 2GIS - Vice City neon character overlay on a sibling 2D canvas. */
(function () {
  'use strict';
  var W = typeof WIN !== 'undefined' ? WIN : window, G = typeof GTA !== 'undefined' && GTA ? GTA : (W.__GTA2GIS__ = W.__GTA2GIS__ || {});
  var ID = 'gta2gis-overlay', cv = null, ctx = null, dpr = 1;
  var NEON = { building: '#ff2bd6', fence: '#19e3ff', bench: '#ffe93d', prop: '#ffe93d', tree: '#37ff9c', lamp: '#37ff9c' };
  function skin(el) {
    el.id = ID; var s = el.style; s.pointerEvents = 'none'; s.position = 'absolute'; s.inset = '0'; s.width = '100%'; s.height = '100%'; s.zIndex = '2';
  }

  function sync(map) {
    var src = map.getCanvas();
    if (!src || !cv) return false;
    if (cv.parentElement !== src.parentElement) src.parentElement.appendChild(cv);
    if (cv.width !== src.width) cv.width = src.width;
    if (cv.height !== src.height) cv.height = src.height;
    dpr = src.width / (src.clientWidth || 1) || 1; return true;
  }

  function attach(map) {
    if (!map || typeof map.getCanvas !== 'function') return null;
    var src = map.getCanvas(), host = src && src.parentElement, found;
    if (!host) return null;
    found = host.querySelector('#' + ID); cv = found || document.createElement('canvas'); skin(cv);
    if (cv.parentElement !== host) host.appendChild(cv);
    ctx = cv.getContext('2d'); sync(map); return cv;
  }
  function clear() {
    if (!cv || !ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
  }

  function drawReticle(sx, sy, w, h) {
    var rx = Math.max(14, Math.min(w - 14, sx)), ry = Math.max(14, Math.min(h - 14, sy - 68));
    ctx.save(); ctx.strokeStyle = 'rgba(30,230,255,.9)'; ctx.lineWidth = 1; ctx.shadowColor = 'rgba(255,46,151,.85)'; ctx.shadowBlur = 7;
    ctx.beginPath(); ctx.arc(rx, ry, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(rx, ry, 1.7, 0, Math.PI * 2); ctx.fillStyle = '#ff2e97'; ctx.fill();
    ctx.restore();
  }

  // Horizontal silhouette for swim / wall-run: the body lies along the projected facing
  // direction (head forward, legs trailing) instead of standing upright.
  function drawHorizontalPose(fx, fy, fwd, u, hr, ph, swim, wall, occ) {
    var bob = swim ? Math.sin(ph * 0.8) * u * 0.07 : 0;
    var kick = Math.sin(ph) * (wall ? 0.55 : 0.35), tilt = wall ? 0.42 : 0;
    ctx.save();
    ctx.translate(fx, fy - (swim ? u * 0.5 : u * 0.62) + bob);
    ctx.rotate(fwd + tilt);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = occ ? 0.22 : 1;
    ctx.strokeStyle = '#12d8ff'; ctx.lineWidth = Math.max(1.5, u * 0.12);
    ctx.shadowColor = 'rgba(255,46,151,.75)'; ctx.shadowBlur = Math.max(4, u * 0.35);
    ctx.beginPath();
    ctx.moveTo(-u * 0.36, 0); ctx.lineTo(-u * 0.98, -u * 0.12 + kick * u * 0.5);
    ctx.moveTo(-u * 0.36, 0); ctx.lineTo(-u * 0.98, u * 0.12 - kick * u * 0.5); ctx.stroke();
    var g = ctx.createLinearGradient(-u * 0.42, 0, u * 0.34, 0);
    g.addColorStop(0, '#ff2e97'); g.addColorStop(0.55, '#a52bff'); g.addColorStop(1, '#19e3ff');
    ctx.shadowColor = 'rgba(255,46,151,.8)'; ctx.shadowBlur = Math.max(6, u * 0.5); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(-u * 0.42, -u * 0.17); ctx.lineTo(u * 0.34, -u * 0.21);
    ctx.lineTo(u * 0.34, u * 0.21); ctx.lineTo(-u * 0.42, u * 0.17); ctx.closePath(); ctx.fill();
    // Arms paddle out to the sides on opposite phases.
    ctx.strokeStyle = 'rgba(120,240,255,.85)'; ctx.lineWidth = Math.max(1, u * 0.08); ctx.beginPath();
    ctx.moveTo(u * 0.12, -u * 0.18); ctx.lineTo(u * 0.02 + Math.cos(ph) * u * 0.32, -u * 0.46 - Math.sin(ph) * u * 0.12);
    ctx.moveTo(u * 0.12, u * 0.18); ctx.lineTo(u * 0.02 - Math.cos(ph) * u * 0.32, u * 0.46 + Math.sin(ph) * u * 0.12);
    ctx.stroke();
    ctx.shadowColor = 'rgba(30,230,255,.9)'; ctx.shadowBlur = Math.max(6, u * 0.45);
    ctx.fillStyle = '#0a1626'; ctx.beginPath(); ctx.arc(u * 0.62, 0, hr, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1, u * 0.05); ctx.strokeStyle = 'rgba(140,246,255,.95)'; ctx.stroke();
    ctx.restore();
  }

  // Stage 3 debug: thin neon OBB footprints, toggled with B, to eyeball collider fit.
  function drawColliders(map, lng, lat) {
    var col = G.collision, ex = G.collisionExtract, list;
    if (!col || !col.state || !col.state.debug || typeof col.getNearby !== 'function' || !ex || typeof ex.worldToLngLat !== 'function') return;
    try { list = col.getNearby(lng, lat, 45); } catch (_) { return; }
    if (!list || !list.length) return;
    ctx.save(); ctx.lineWidth = 1; ctx.setLineDash([]);
    for (var i = 0; i < list.length; i++) {
      var o = list[i]; if (!o) continue;
      var wx = +o.wx, wy = +o.wy, hx = +o.hx || 0, hy = +o.hy || 0;
      if (!isFinite(wx) || !isFinite(wy) || (!hx && !hy)) continue;
      var a = +o.a || +o.angle || +o.rot || +o.theta || 0, c = Math.cos(a), s = Math.sin(a);
      var paint = NEON[o.kind || o.type || o.k] || '#ff2bd6', pts = [], bad = false;
      for (var k = 0; k < 4 && !bad; k++) {
        var dx = (k < 2 ? 1 : -1) * hx, dy = (k === 0 || k === 3 ? 1 : -1) * hy;
        var ll = ex.worldToLngLat(wx + dx * c - dy * s, wy + dx * s + dy * c);
        if (ll && !ll.length && isFinite(ll.lng)) ll = [ll.lng, ll.lat];
        var q = ll ? map.project([+ll[0], +ll[1]]) : null;
        if (!q || !isFinite(q[0]) || !isFinite(q[1])) bad = true; else pts.push(q);
      }
      if (bad || pts.length < 4) continue;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (var j = 1; j < 4; j++) ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.closePath(); ctx.globalAlpha = .9; ctx.strokeStyle = paint; ctx.shadowColor = paint; ctx.shadowBlur = 3; ctx.stroke();
    }
    ctx.restore();
  }

  function render(map, playerState) {
    if (!map || typeof map.getCanvas !== 'function' || !cv) return;
    sync(map); clear();
    if (!playerState || !playerState.active || !ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var w = cv.width / dpr, h = cv.height / dpr;
    var lng = +playerState.lng, lat = +playerState.lat;
    if (!isFinite(lng) || !isFinite(lat)) return;
    var p = map.project([lng, lat]), sx = p && p[0], sy = p && p[1];
    if (!isFinite(sx) || !isFinite(sy)) return;
    drawColliders(map, lng, lat);
    // Real 3D character (WebGL custom layer + DEPTH_TEST) draws itself: never paint the 2D silhouette over it.
    if (G.playerGL) {
      // Car mode: playerState is vehicle state (active:true at car coords), so hide the character GL layer.
      G.playerGL.setState(playerState && playerState.mode === 'car' ? { active: false } : playerState);
      if (playerState.pointerLocked) drawReticle(sx, sy, w, h); else drawReticle(w / 2, h / 2 + 68, w, h);
      return;
    }
    var pitch = +(typeof map.getPitch === 'function' ? map.getPitch() : 60) || 0;
    var sinP = Math.max(0.2, Math.sin(pitch * Math.PI / 180)), cosLat = Math.max(0.15, Math.cos(lat * Math.PI / 180));
    var qN = map.project([lng, lat + 1 / 111320]), qE = map.project([lng + 1 / (111320 * cosLat), lat]);
    var dN = qN && isFinite(qN[0]) && isFinite(qN[1]) ? Math.hypot(qN[0] - sx, qN[1] - sy) : 0;
    var dE = qE && isFinite(qE[0]) && isFinite(qE[1]) ? Math.hypot(qE[0] - sx, qE[1] - sy) : 0;
    var u = Math.max(4, Math.min(48, Math.max(dN, dE) || 14)), z = Math.max(0, +playerState.z || 0), lift = z * u * sinP * 1.15;

    // Ground contact shadow: shrinks, softens and drifts violet while airborne.
    var t = Math.min(1, z / 2.2), rx = u * 0.55 * (1 - 0.35 * t), ry = Math.max(1.5, u * 0.2 * (1 - 0.3 * t));
    var sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rx);
    sg.addColorStop(0, 'rgba(14,4,24,.86)'); sg.addColorStop(0.65, 'rgba(38,10,58,.5)'); sg.addColorStop(1, 'rgba(255,46,151,0)');
    ctx.save(); ctx.globalAlpha = 0.55 * (1 - 0.5 * t); ctx.fillStyle = sg; ctx.beginPath();
    ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();

    // Facing ring + arrow, projected through 3D map space so it stays accurate.
    var hRad = (+playerState.heading || 0) * Math.PI / 180, r = 2.0 / 111320;
    var fp = map.project([lng + (Math.sin(hRad) * r) / cosLat, lat + Math.cos(hRad) * r]);
    ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = '#19e3ff'; ctx.lineWidth = Math.max(1, u * 0.05);
    ctx.beginPath(); ctx.ellipse(sx, sy, u * 0.85, Math.max(2, u * 0.3), 0, 0, Math.PI * 2); ctx.stroke();
    if (fp && isFinite(fp[0]) && isFinite(fp[1])) {
      ctx.globalAlpha = 0.85; ctx.strokeStyle = '#ff2e97'; ctx.shadowColor = 'rgba(255,46,151,.9)'; ctx.shadowBlur = Math.max(4, u * 0.3); ctx.lineWidth = Math.max(1.5, u * 0.09);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(fp[0], fp[1]); ctx.stroke();
      ctx.beginPath(); ctx.arc(fp[0], fp[1], Math.max(1.5, u * 0.09), 0, Math.PI * 2); ctx.fillStyle = '#19e3ff'; ctx.fill();
    }
    ctx.restore();

    // Stylised silhouette fallback. Feet sit at the projected ground point minus jump lift.
    var occ = !!playerState.occluded, fx = sx, fy = sy - lift, spd = +playerState.speed || 0, ph = +playerState.walkPhase || 0;
    // Pose selector mirrors the 3D layer: swim / wall-run lie horizontal, jump tucks legs and lifts arms.
    var proto = !!playerState.prototype, swim = !!playerState.swimming, wall = !swim && !!playerState.wallRunning;
    var air = !swim && !wall && playerState.grounded != null && !playerState.grounded;
    var walk = spd > 0.3, swing = walk ? Math.sin(ph) : 0, top = fy - (walk ? Math.abs(Math.cos(ph)) * u * 0.06 : 0);
    var hr = Math.max(2, u * 0.16);
    if (swim || wall) {
      var fwd = fp && isFinite(fp[0]) && isFinite(fp[1]) ? Math.atan2(fp[1] - sy, fp[0] - sx) : -Math.PI / 2;
      drawHorizontalPose(fx, fy, fwd, u, hr, ph, swim, wall, occ);
      if (playerState.pointerLocked) drawReticle(sx, sy, w, h);
      return;
    }
    if (proto && walk) { swing = Math.sin(ph * 1.7); top = fy - Math.abs(Math.cos(ph * 1.7)) * u * 0.09; }
    var foot = air ? fy - u * 0.4 : fy;
    var hip = top - u * 0.92, sho = top - u * 1.42, hy = top - u * 1.62;
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.globalAlpha = occ ? 0.22 : 1;
    ctx.strokeStyle = '#12d8ff'; ctx.lineWidth = Math.max(1.5, u * 0.12); ctx.shadowColor = 'rgba(255,46,151,.75)'; ctx.shadowBlur = Math.max(4, u * 0.35);
    ctx.beginPath(); ctx.moveTo(fx, hip); ctx.lineTo(fx - u * 0.16 + swing * u * 0.34, foot);
    ctx.moveTo(fx, hip); ctx.lineTo(fx + u * 0.16 - swing * u * 0.34, foot); ctx.stroke();
    var g = ctx.createLinearGradient(fx - u * 0.3, sho, fx + u * 0.3, hip);
    g.addColorStop(0, '#ff2e97'); g.addColorStop(0.55, '#a52bff'); g.addColorStop(1, '#19e3ff');
    ctx.shadowColor = 'rgba(255,46,151,.8)'; ctx.shadowBlur = Math.max(6, u * 0.5); ctx.fillStyle = g; ctx.beginPath();
    ctx.moveTo(fx - u * 0.23, sho); ctx.lineTo(fx + u * 0.23, sho); ctx.lineTo(fx + u * 0.17, hip); ctx.lineTo(fx - u * 0.17, hip);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(120,240,255,.85)'; ctx.lineWidth = Math.max(1, u * 0.08); ctx.beginPath();
    var asx = proto ? u * 0.26 : u * 0.21, aex = air ? u * 0.16 : u * 0.3, aey = air ? sho - u * 0.32 : hip + u * 0.1;
    ctx.moveTo(fx - asx, sho + u * 0.06); ctx.lineTo(fx - aex - swing * u * 0.12, aey);
    ctx.moveTo(fx + asx, sho + u * 0.06); ctx.lineTo(fx + aex + swing * u * 0.12, aey); ctx.stroke();
    ctx.shadowColor = 'rgba(30,230,255,.9)'; ctx.shadowBlur = Math.max(6, u * 0.45);
    ctx.fillStyle = '#0a1626'; ctx.beginPath(); ctx.arc(fx, hy, hr, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1, u * 0.05); ctx.strokeStyle = 'rgba(140,246,255,.95)'; ctx.stroke();

    // Behind-building ghost: faint fill plus a dashed cyan hull, GTA style.
    if (occ) {
      ctx.globalAlpha = .95; ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(30,230,255,.92)'; ctx.lineWidth = Math.max(1, u * 0.045);
      ctx.setLineDash([Math.max(3, u * 0.16), Math.max(2, u * 0.11)]); ctx.beginPath();
      ctx.moveTo(fx - u * 0.23, sho); ctx.lineTo(fx + u * 0.23, sho); ctx.lineTo(fx + u * 0.17, hip); ctx.lineTo(fx - u * 0.17, hip); ctx.closePath();
      ctx.moveTo(fx - u * 0.16, hip); ctx.lineTo(fx - u * 0.16 + swing * u * 0.34, foot);
      ctx.moveTo(fx + u * 0.16, hip); ctx.lineTo(fx + u * 0.16 - swing * u * 0.34, foot);
      ctx.moveTo(fx + hr, hy); ctx.arc(fx, hy, hr, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    if (playerState.pointerLocked) drawReticle(sx, sy, w, h);
  }

  function detach() { if (cv && cv.parentElement) cv.parentElement.removeChild(cv); cv = null; ctx = null; }

  G.overlay = { attach: attach, render: render, clear: clear, detach: detach };
})();
