(function (WIN, GTA) {
  'use strict';
  const doc = WIN.document, D2R = Math.PI / 180, M_LAT = 111320, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, f) => (typeof v === 'number' && isFinite(v) ? v : f), wrap = (d) => (((d + 180) % 360) + 360) % 360 - 180;
  const WALK_SPEED = 4.6, RUN_SPEED = 9.2, ACCEL = 28, FRICTION = 14, AIR = 0.35, JUMP_VEL = 5.6, GRAVITY = 15.5;
  const SENS_X = 0.22, SENS_Y = 0.16, TURN = 95, PITCH_MIN = -65, PITCH_MAX = 78, DIST_MIN = 2.5, DIST_MAX = 22, DIST_STEP = 0.6;
  const DIST_DEF = 6.5, NEAR_MIN = 20, NEAR_M = 0.35, EYE = 1.45, FLOOR = 0.45, WPM_DEF = 228.3, ZOOM = 19.5;
  const PROTO_RUN_SPEED = 28, PROTO_JUMP_VEL = 26, PROTO_STEP_UP = 1.5, PROTO_AIR = 0.65;
  const SWIM_SPEED = 2.6, WALL_RUN_TIME = 1.2, WALL_RUN_GRAVITY = 0.25;
  const FOG_DISTANCE_MULT = 8, VIEW_RADIUS_M = 600;
  const KEY_RE = /^(Key[WASDQE]|Arrow(Up|Down|Left|Right)|Shift(Left|Right)|Space)$/;
  const BLOCK_RE = /^(Key[WASD]|Arrow(Up|Down|Left|Right)|Space)$/;
  const state = {
    active: false, mode: 'foot', lng: 0, lat: 0, z: 0, vz: 0, vx: 0, vy: 0, speed: 0, heading: 0, yaw: 0,
    pitch: 28, camDist: DIST_DEF, grounded: true, sprinting: false, prototype: false, floorZ: 0, occluded: false, pointerLocked: false, walkPhase: 0, savedCam: null,
    swimming: false, wallRunning: false, wallRunT: 0
  };
  const keys = Object.create(null), listeners = [];
  let map = null, canvas = null, rightDrag = false, cam = null, origVM = null, origNF = null, origGVV = null, origNear = 1000, origMinFog = 20000, origMaxFog = 0;
  const editable = () => { const a = doc.activeElement; return !!a && (/^(input|textarea|select)$/i.test(a.tagName || '') || a.isContentEditable === true); };
  const clearKeys = () => { for (const k in keys) delete keys[k]; };
  const listen = (t, ty, fn, o) => { if (t) { t.addEventListener(ty, fn, o); listeners.push([t, ty, fn, o]); } };
  const release = () => { while (listeners.length) { const l = listeners.pop(); try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (_) {} } };
  const camVal = (fn, fb) => num(typeof map[fn] === 'function' ? map[fn]() : undefined, fb);
  const wpmOf = (ex) => num(ex && typeof ex.wpmAtLat === 'function' ? ex.wpmAtLat(state.lat) : NaN, WPM_DEF);
  const nearWorld = () => Math.max(NEAR_MIN, NEAR_M * wpmOf(GTA.collisionExtract));
  function lookAt(m, e, t, up) {
    let fx = t[0] - e[0], fy = t[1] - e[1], fz = t[2] - e[2]; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let sx = fy * up[2] - fz * up[1], sy = fz * up[0] - fx * up[2], sz = fx * up[1] - fy * up[0]; const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    const ux = sy * fz - sz * fy, uy = sz * fx - sx * fz, uz = sx * fy - sy * fx;
    m[0] = sx; m[1] = ux; m[2] = -fx; m[3] = 0; m[4] = sy; m[5] = uy; m[6] = -fy; m[7] = 0;
    m[8] = sz; m[9] = uz; m[10] = -fz; m[11] = 0; m[15] = 1;
    m[12] = -(sx * e[0] + sy * e[1] + sz * e[2]); m[13] = -(ux * e[0] + uy * e[1] + uz * e[2]); m[14] = fx * e[0] + fy * e[1] + fz * e[2];
  }
  function orbit(c) {
    const ex = GTA.collisionExtract; if (!ex || typeof ex.lngLatToWorld !== 'function') return;
    const p = ex.lngLatToWorld(state.lng, state.lat), w = wpmOf(ex); if (!p || !isFinite(p[0]) || !isFinite(p[1]) || !(w > 0)) return;
    const yr = state.yaw * D2R, pr = state.pitch * D2R, tx = p[0], ty = p[1], dist = state.camDist * w, hDist = dist * Math.cos(pr);
    const tz = (num(state.z, 0) + EYE) * w - Math.sin(pr) * dist * 0.85 * clamp((-state.pitch - 15) / 12, 0, 1);
    const exEye = tx + Math.sin(yr) * hDist, eyEye = ty - Math.cos(yr) * hDist, ezEye = Math.max(FLOOR * w, tz + dist * Math.sin(pr));
    lookAt(c.viewMatrix, [exEye, eyEye, ezEye], [tx, ty, tz], [0, 0, 1]);
    if (c.position) { c.position[0] = exEye; c.position[1] = eyEye; c.position[2] = ezEye; }
    const cfg = c.state && c.state.cameraConfig; if (cfg) { cfg.near = Math.max(NEAR_MIN, NEAR_M * w); cfg.minFogDistance = origMinFog * FOG_DISTANCE_MULT;
      if (origMaxFog > 0 && 'maxFogDistance' in cfg) cfg.maxFogDistance = origMaxFog * FOG_DISTANCE_MULT; }
  }
  function install() {
    const c = map && map._impl && map._impl.core && map._impl.core.modules && map._impl.core.modules.camera;
    if (!c || typeof c.updateViewMatrix !== 'function') return;
    if (cam && cam !== c) uninstall(); if (cam) return;
    cam = c; origVM = c.updateViewMatrix; origNF = c.restoreFixedNearFar; origGVV = typeof c.getViewportVertices === 'function' ? c.getViewportVertices : null;
    const cfg = c.state && c.state.cameraConfig; origNear = num(cfg && cfg.near, 1000); origMinFog = num(cfg && cfg.minFogDistance, 20000); origMaxFog = num(cfg && cfg.maxFogDistance, 0); c.updateViewMatrix = function () { origVM.apply(this, arguments); if (state.active) try { orbit(this); } catch (_) {} };
    if (origGVV) c.getViewportVertices = function () { const ex = GTA.collisionExtract, cnt = state.active && this.state && this.state.center; if (!cnt || !ex || !ex.worldToLngLat || !ex.wpmAtLat) return origGVV.call(this);
      const ll = ex.worldToLngLat(cnt[0], cnt[1]), r = VIEW_RADIUS_M * num(ex.wpmAtLat(ll[1]), WPM_DEF); return [[cnt[0] - r, cnt[1] - r, 0], [cnt[0] + r, cnt[1] - r, 0], [cnt[0] + r, cnt[1] + r, 0], [cnt[0] - r, cnt[1] + r, 0]];
    };
    if (typeof origNF === 'function') c.restoreFixedNearFar = function () {
      origNF.apply(this, arguments); if (state.active) { const g = this.state && this.state.cameraConfig; if (g) g.near = nearWorld(); }
    };
  }
  function uninstall() {
    if (!cam) return;
    try { if (origVM) cam.updateViewMatrix = origVM; if (origNF) cam.restoreFixedNearFar = origNF; if (origGVV) cam.getViewportVertices = origGVV;
      const cfg = cam.state && cam.state.cameraConfig; if (cfg) { cfg.near = origNear; cfg.minFogDistance = origMinFog; if (origMaxFog > 0 && 'maxFogDistance' in cfg) cfg.maxFogDistance = origMaxFog; } } catch (_) {}
    cam = null; origVM = origNF = origGVV = null; origMaxFog = 0;
  }
  const saveCam = () => {
    const p = map.getPadding && map.getPadding();
    state.savedCam = { center: (map.getCenter && map.getCenter()) || [state.lng, state.lat], zoom: camVal('getZoom', ZOOM),
      pitch: camVal('getPitch', 0), rotation: camVal('getRotation', 0), padding: p ? { top: num(p.top, 0), bottom: num(p.bottom, 0), left: num(p.left, 0), right: num(p.right, 0) } : null };
  };
  function sync() {
    if (!map) return; if (!cam) install();
    const cfg = cam && cam.state && cam.state.cameraConfig; if (cfg) cfg.near = nearWorld();
    try { map.setCenter([state.lng, state.lat], { duration: 0 }); map.setRotation(state.yaw, { duration: 0 });
      map.setZoom(ZOOM, { duration: 0 }); map.setPitch(clamp(state.pitch, 28, 68), { duration: 0 }); } catch (_) {}
  }
  function onMove(e) {
    if (!state.active || !(state.pointerLocked || rightDrag)) return;
    state.yaw = wrap(state.yaw - num(e.movementX, 0) * SENS_X);
    state.pitch = clamp(state.pitch + num(e.movementY, 0) * SENS_Y, PITCH_MIN, PITCH_MAX);
  }
  function onWheel(e) {
    if (!state.active) return; e.preventDefault();
    state.camDist = clamp(state.camDist + Math.sign(num(e.deltaY, 0)) * DIST_STEP, DIST_MIN, DIST_MAX);
  }
  const requestLock = () => { try { if (canvas && doc.pointerLockElement !== canvas) canvas.requestPointerLock?.(); } catch (_) {} return api; };
  const onKeyDown = (e) => { if (state.active && !editable() && KEY_RE.test(e.code)) { keys[e.code] = true; if (BLOCK_RE.test(e.code)) e.preventDefault(); } };
  const onKeyUp = (e) => { delete keys[e.code]; }, onLock = () => { state.pointerLocked = !!canvas && doc.pointerLockElement === canvas; };
  const onClick = () => { if (state.active && !state.pointerLocked) requestLock(); }, onDown = (e) => { if (state.active && e.button === 2) rightDrag = true; };
  const onUp = (e) => { if (e.button === 2) rightDrag = false; }, onCtx = (e) => { if (state.active) e.preventDefault(); };
  function bind() {
    listen(WIN, 'keydown', onKeyDown, true); listen(WIN, 'keyup', onKeyUp, true); listen(WIN, 'blur', clearKeys, false);
    listen(doc, 'mousemove', onMove, false); listen(doc, 'mouseup', onUp, false); listen(doc, 'pointerlockchange', onLock, false);
    listen(doc, 'wheel', onWheel, { passive: false }); listen(canvas, 'click', onClick, false); listen(canvas, 'mousedown', onDown, false); listen(canvas, 'contextmenu', onCtx, false);
  }
  function init(m) { map = m || map || (GTA.probe && GTA.probe.state && GTA.probe.state.map) || WIN.mapgl || null; return api; }
  function enable(m) {
    if (state.active) return api; init(m); if (!map) return api;
    try { canvas = (map.getCanvas && map.getCanvas()) || canvas; } catch (_) {}
    saveCam(); const c = map.getCenter && map.getCenter(); if (c) { state.lng = num(c[0], state.lng); state.lat = num(c[1], state.lat); }
    state.yaw = wrap(camVal('getRotation', 0));
    Object.assign(state, { active: true, z: 0, vz: 0, vx: 0, vy: 0, floorZ: 0, grounded: true, sprinting: false, occluded: false, pointerLocked: false, walkPhase: 0, heading: state.yaw, swimming: false, wallRunning: false, wallRunT: 0 });
    install();
    try { map._impl.core.modules.handler.block(); } catch (_) { try { map.blockInteraction && map.blockInteraction(); } catch (_) {} }
    try { map.setOption && map.setOption('disableDragging', true); } catch (_) {}
    bind(); sync(); return api;
  }
  function disable() {
    if (!state.active) return api;
    state.active = state.pointerLocked = false; rightDrag = false; release(); clearKeys(); try { if (cam && origGVV) cam.getViewportVertices = origGVV; } catch (_) {} uninstall();
    try { map._impl.core.modules.handler.unblock(); } catch (_) {}
    try { doc.exitPointerLock?.(); } catch (_) {}
    try { map.setOption && map.setOption('disableDragging', false); map.unblockInteraction?.(); } catch (_) {}
    const s = state.savedCam; if (map && s) try {
      if (s.padding) map.setPadding(s.padding);
      map.setCenter(Array.isArray(s.center) ? s.center : [state.lng, state.lat], { duration: 0 });
      map.setZoom(s.zoom, { duration: 0 }); map.setPitch(s.pitch, { duration: 0 }); map.setRotation(s.rotation, { duration: 0 });
    } catch (_) {}
    state.savedCam = null; return api;
  }
  const toggle = () => (state.active ? disable() : enable()), isActive = () => state.active;
  function step(dt) {
    if (!state.active || !map) return;
    const d = clamp(num(dt, 0), 0, 0.05); if (!d) return;
    const turn = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0); if (turn) state.yaw = wrap(state.yaw + turn * TURN * d);
    const yr = state.yaw * D2R, fE = -Math.sin(yr), fN = Math.cos(yr), rE = Math.cos(yr), rN = Math.sin(yr);
    let mf = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    let mr = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const mag = Math.hypot(mf, mr), moving = mag > 0; if (mag > 1) { mf /= mag; mr /= mag; }
    state.sprinting = moving && !(state.swimming && !state.prototype) && !!(keys.ShiftLeft || keys.ShiftRight);
    const airAcc = state.prototype ? PROTO_AIR : AIR;
    const acc = (state.grounded ? ACCEL : ACCEL * airAcc) * d;
    if (moving) {
      const top = state.prototype ? PROTO_RUN_SPEED : (state.swimming ? SWIM_SPEED : (state.sprinting ? RUN_SPEED : WALK_SPEED));
      state.vx += clamp((fE * mf + rE * mr) * top - state.vx, -acc, acc); state.vy += clamp((fN * mf + rN * mr) * top - state.vy, -acc, acc);
    } else { const fr = Math.max(0, 1 - (state.grounded ? FRICTION : FRICTION * 0.15) * d); state.vx *= fr; state.vy *= fr; if (Math.hypot(state.vx, state.vy) < 0.02) state.vx = state.vy = 0; }
    const col = GTA.collision; try { col && col.refresh && col.refresh(map, state.lng, state.lat); } catch (_) {}
    let grounded = state.grounded, floorZ = state.floorZ, applied = false, inWater = false;
    if (col && typeof col.resolveFoot === 'function') try {
      const r = col.resolveFoot(state.lng, state.lat, state.vx * d, state.vy * d, state.z, 0.38, state.prototype ? PROTO_STEP_UP : 0.55);
      if (r && typeof r === 'object') { state.lng = num(r.lng, state.lng); state.lat = num(r.lat, state.lat); state.z = num(r.z, state.z);
        floorZ = num(r.supportZ, 0); if (typeof r.grounded === 'boolean') grounded = r.grounded; applied = true; inWater = !!r.inWater; }
    } catch (_) {}
    if (!applied) { state.lng += (state.vx * d) / Math.max(1, M_LAT * Math.cos(state.lat * D2R)); state.lat += (state.vy * d) / M_LAT; }
    state.swimming = inWater; const buoyant = inWater && !state.prototype;
    if (keys.Space && grounded && !buoyant) { state.vz = state.prototype ? PROTO_JUMP_VEL : JUMP_VEL; grounded = false; }
    if (state.prototype && !grounded && !state.wallRunning && moving) {
      const hit = col && col.state && col.state.lastHit;
      if (hit) { state.wallRunning = true; state.wallRunT = WALL_RUN_TIME; }
    }
    if (state.wallRunning) { state.wallRunT -= d; if (state.wallRunT <= 0 || grounded) { state.wallRunning = false; state.wallRunT = 0; } }
    if (buoyant) { state.vz = 0; const surf = Math.max(0, floorZ); if (state.z > surf) state.z = Math.max(surf, state.z - 4 * d); grounded = state.z <= floorZ + 0.05; }
    else if (!grounded || state.z > floorZ) {
      state.vz -= GRAVITY * (state.wallRunning ? WALL_RUN_GRAVITY : 1) * d; state.z += state.vz * d;
      if (state.z <= floorZ) { state.z = floorZ; state.vz = 0; grounded = true; } else if (state.z > floorZ + 0.05) grounded = false;
    }
    if (grounded) { state.wallRunning = false; state.wallRunT = 0; }
    state.floorZ = floorZ; state.grounded = grounded;
    state.occluded = !!(col && typeof col.isOccluded === 'function' && col.isOccluded(map, state.lng, state.lat, state.z, state.yaw, state.pitch));
    state.speed = Math.hypot(state.vx, state.vy); if (state.speed > 0.2) state.heading = Math.atan2(state.vx, state.vy) / D2R;
    state.walkPhase += state.speed * d * 2.2; sync();
  }
  const api = { state, init, enable, disable, toggle, step, requestLock, isActive };
  api.setPrototype = function (on) { state.prototype = !!on; return api; };
  GTA.player = api;
})(WIN, GTA);
