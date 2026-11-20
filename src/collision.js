/* src/collision.js — 3D OBB collision, step-up, camera occlusion, debug boxes. */
(function (WIN, GTA) {
  'use strict';
  const PI = Math.PI, RAD = PI / 180, M_LAT = 111320, STEP_UP = 0.55;
  const num = (v, f) => (typeof v === 'number' && isFinite(v) ? v : f);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const vec = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.y] : null);
  const state = {
    enabled: true, debug: false, boxes: [],
    stats: { gltfCount: 0, meshCount: 0, tilesScanned: 0, total: 0 },
    lastRefresh: 0, lastPos: null, occluded: false, lastHit: null, inWater: false
  };
  let mapRef = null;
  const getEx = () => (GTA.collisionExtract && typeof GTA.collisionExtract === 'object' ? GTA.collisionExtract : null);
  function toWorld(ex, lng, lat) {
    if (!ex || typeof ex.lngLatToWorld !== 'function') return null;
    try { const p = vec(ex.lngLatToWorld(lng, lat)); return p && isFinite(p[0]) && isFinite(p[1]) ? [p[0], p[1]] : null; } catch (_) { return null; }
  }
  function toLngLat(ex, wx, wy) {
    if (!ex || typeof ex.worldToLngLat !== 'function') return null;
    try { const p = vec(ex.worldToLngLat(wx, wy)); return p && isFinite(p[0]) && isFinite(p[1]) ? p : null; } catch (_) { return null; }
  }
  const getWpm = (ex, lat) => {
    try { const w = ex && typeof ex.wpmAtLat === 'function' ? ex.wpmAtLat(lat) : 0; return num(w, 0) > 0 ? w : 0; } catch (_) { return 0; }
  };
  function refresh(map, lng, lat, force) {
    if (map) mapRef = map;
    const ex = getEx();
    if (!ex || typeof ex.extractNear !== 'function' || !state.enabled) return state.boxes;
    const now = Date.now(), p = toWorld(ex, lng, lat), wpm = getWpm(ex, lat), elapsed = now - state.lastRefresh;
    const moved = p && state.lastPos && wpm > 0 ? Math.hypot(p[0] - state.lastPos[0], p[1] - state.lastPos[1]) / wpm : Infinity;
    if (!force && elapsed <= 2500 && moved <= 60 && !(state.boxes.length === 0 && elapsed > 500)) return state.boxes;
    state.lastRefresh = now; if (p) state.lastPos = p;
    let res; try { res = ex.extractNear(map || mapRef, lng, lat, 130); } catch (err) { console.warn('[GTA2GIS] collision extract failed', err); return state.boxes; }
    const boxes = Array.isArray(res) ? res : res && Array.isArray(res.boxes) ? res.boxes : [], s = (res && res.stats) || {};
    for (let i = 0; i < boxes.length; i++) { const b = boxes[i]; if (b && isFinite(b.cos) && isFinite(b.sin)) b.a = Math.atan2(b.sin, b.cos); }
    state.boxes = boxes;
    state.stats = { gltfCount: num(s.gltfCount, 0), meshCount: num(s.meshCount, 0), tilesScanned: num(s.tilesScanned, 0), total: num(s.total, boxes.length) };
    return state.boxes;
  }
  function resolveFoot(lng, lat, dE, dN, z, radiusM, stepUp) {
    z = num(z, 0); radiusM = num(radiusM, 0.38); if (!(radiusM > 0)) radiusM = 0.38;
    const sp = num(stepUp, STEP_UP);
    state.lastHit = null; state.inWater = false;
    const ex = getEx(), p0 = toWorld(ex, lng, lat), wpm = getWpm(ex, lat);
    if (mapRef && ex) refresh(mapRef, lng, lat);
    if (!state.enabled || !p0 || !(wpm > 0)) {
      const c = Math.max(0.05, Math.cos(lat * RAD));
      return { lng: lng + num(dE, 0) / (M_LAT * c), lat: lat + num(dN, 0) / M_LAT, z, supportZ: 0, grounded: z <= 0.02, hit: null, inWater: state.inWater };
    }
    let wx = p0[0] + num(dE, 0) * wpm, wy = p0[1] + num(dN, 0) * wpm, supportZ = 0;
    const rW = radiusM * wpm;
    for (let it = 0; it < 2; it++) for (let i = 0; i < state.boxes.length; i++) {
      const b = state.boxes[i];
      if (!b || !isFinite(b.wx) || !isFinite(b.wy) || !isFinite(b.hx) || !isFinite(b.hy) || !isFinite(b.h)) continue;
      const dx = wx - b.wx, dy = wy - b.wy, maxR = b.hx + b.hy + rW;
      if (dx * dx + dy * dy >= maxR * maxR) continue;
      const co = num(b.cos, 1), si = num(b.sin, 0), lx = dx * co + dy * si, ly = -dx * si + dy * co;
      const cx = clamp(lx, -b.hx, b.hx), cy = clamp(ly, -b.hy, b.hy);
      const exx = lx - cx, eyy = ly - cy, dsq = exx * exx + eyy * eyy;
      if (b.kind === 'water') { if (dsq < rW * rW) state.inWater = true; continue; }
      if (dsq >= rW * rW) continue;
      const isRoad = b.kind === 'road';
      const spB = isRoad ? Math.max(sp, 1.2) : sp;
      if (!isRoad && z < num(b.z0, 0)) continue;
      if (z >= b.h - spB) {
        const m = rW * 0.6;
        if (Math.abs(lx) <= b.hx + m && Math.abs(ly) <= b.hy + m && b.h > supportZ) supportZ = b.h;
        continue;
      }
      if (isRoad) {
        const m = rW * 0.6;
        if (Math.abs(lx) <= b.hx + m && Math.abs(ly) <= b.hy + m && b.h <= z + spB && b.h > supportZ) supportZ = b.h;
        continue;
      }
      if (dsq > 1e-8) {
        const d = Math.sqrt(dsq), k = (rW - d) / d;
        wx += exx * k * co - eyy * k * si; wy += exx * k * si + eyy * k * co;
      } else {
        const px = b.hx - Math.abs(lx), py = b.hy - Math.abs(ly);
        if (px < py) { const s = (lx >= 0 ? 1 : -1) * (px + rW); wx += s * co; wy += s * si; }
        else { const s = (ly >= 0 ? 1 : -1) * (py + rW); wx -= s * si; wy += s * co; }
      }
      state.lastHit = { kind: b.kind, sub: b.sub };
    }
    const back = toLngLat(ex, wx, wy);
    let nLng, nLat;
    if (back) { nLng = back[0]; nLat = back[1]; }
    else {
      const c = Math.max(0.05, Math.cos(lat * RAD));
      nLng = lng + (wx - p0[0]) / (wpm * M_LAT * c); nLat = lat + (wy - p0[1]) / (wpm * M_LAT);
    }
    return { lng: nLng, lat: nLat, z: Math.max(z, supportZ), supportZ, grounded: z <= supportZ + 0.02, hit: state.lastHit, inWater: state.inWater };
  }
  function isOccluded(map, lng, lat, z, yaw, pitch) {
    z = num(z, 0); if (map) mapRef = map;
    const ex = getEx();
    if (!state.enabled) { state.occluded = false; return false; }
    if (mapRef && ex) refresh(mapRef, lng, lat);
    const p = toWorld(ex, lng, lat), wpm = getWpm(ex, lat);
    if (!p || !(wpm > 0)) { state.occluded = false; return false; }
    let vx = 0, vy = -1;
    try {
      const sp = map && map.project([lng, lat]), sq = sp && map.unproject([sp[0], sp[1] + 40]);
      const p2 = sq && toWorld(ex, sq[0], sq[1]);
      if (p2) { const len = Math.hypot(p2[0] - p[0], p2[1] - p[1]); if (len > 1e-6) { vx = (p2[0] - p[0]) / len; vy = (p2[1] - p[1]) / len; } }
    } catch (_) { const r = num(yaw, 0) * RAD; vx = -Math.sin(r); vy = -Math.cos(r); }
    const near = 2.5 * wpm, far = 38 * wpm;
    const tanUp = Math.tan((90 - clamp(num(pitch, 58), 1, 89)) * RAD);
    for (let i = 0; i < state.boxes.length; i++) {
      const b = state.boxes[i];
      if (!b || !isFinite(b.hx) || !isFinite(b.hy) || !(b.h > z + 1.8)) continue;
      if (b.kind === 'water') continue;
      const co = num(b.cos, 1), si = num(b.sin, 0), dx = p[0] - b.wx, dy = p[1] - b.wy;
      const ox = dx * co + dy * si, oy = -dx * si + dy * co, rx = vx * co + vy * si, ry = -vx * si + vy * co;
      let t0 = -Infinity, t1 = Infinity, a, c;
      if (Math.abs(rx) < 1e-9) { if (ox < -b.hx || ox > b.hx) continue; }
      else { a = (-b.hx - ox) / rx; c = (b.hx - ox) / rx; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c)); }
      if (Math.abs(ry) < 1e-9) { if (oy < -b.hy || oy > b.hy) continue; }
      else { a = (-b.hy - oy) / ry; c = (b.hy - oy) / ry; t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c)); }
      if (t1 < 0) continue;
      const t = Math.max(t0, near);
      if (t > far || t > t1) continue;
      if (b.h > z + (t / wpm) * tanUp) { state.occluded = true; return true; }
    }
    state.occluded = false; return false;
  }
  function getNearby(lng, lat, maxDistM) {
    const ex = getEx(), p = toWorld(ex, lng, lat), wpm = getWpm(ex, lat), limit = num(maxDistM, 45) * wpm, out = [];
    if (!p || !(wpm > 0)) return out;
    for (let i = 0; i < state.boxes.length && out.length < 80; i++) {
      const b = state.boxes[i]; if (!b) continue;
      const dx = b.wx - p[0], dy = b.wy - p[1];
      if (dx * dx + dy * dy <= limit * limit) out.push(b);
    }
    return out;
  }
  function toggleDebug(on) { state.debug = typeof on === 'boolean' ? on : !state.debug; return state.debug; }
  function setEnabled(on) {
    state.enabled = !!on;
    if (state.enabled) { state.lastRefresh = 0; state.lastPos = null; }
    else { state.boxes = []; state.occluded = false; state.lastHit = null; }
    return state.enabled;
  }
  GTA.collision = { state, refresh, resolveFoot, isOccluded, getNearby, toggleDebug, setEnabled };
})(typeof WIN !== 'undefined' ? WIN : window,
  typeof GTA !== 'undefined' ? GTA : ((typeof WIN !== 'undefined' ? WIN : window).__GTA2GIS__ =
    (typeof WIN !== 'undefined' ? WIN : window).__GTA2GIS__ || {}));
