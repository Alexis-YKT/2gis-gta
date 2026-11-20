(function (WIN, GTA) {
  'use strict';
  const doc = WIN.document, D2R = Math.PI / 180, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, f) => (typeof v === 'number' && isFinite(v) ? v : f), sign = (v) => (v < 0 ? -1 : 1);
  const LEN = 4.4, WID = 1.9, MAX_SPEED = 38, REV = -8, ACCEL = 9, BRAKE = 18, COAST = 2.5;
  const STEER_MAX = 0.55, STEER_RATE = 2.6, GRIP = 7.5, DRIFT_GRIP = 1.5, WHEELBASE = 2.6;
  const KEY_RE = /^(Key[WASD]|Arrow(Up|Down|Left|Right)|Space)$/, BLOCK_RE = /^(Arrow|Space)/;
  const state = { active: false, mode: 'car', lng: 0, lat: 0, z: 0, heading: 0, speed: 0, steer: 0, vx: 0, vy: 0, drift: 0, spin: 0, wheelPhase: 0 };
  const keys = Object.create(null);
  let map = null, listeners = [];
  const editable = () => { const a = doc.activeElement; return !!a && (/^(input|textarea|select)$/i.test(a.tagName || '') || a.isContentEditable === true); };
  const clearKeys = () => { for (const k in keys) delete keys[k]; };
  function bind() {
    const down = (e) => { if (!state.active || editable() || !KEY_RE.test(e.code)) return; keys[e.code] = true; if (BLOCK_RE.test(e.code)) e.preventDefault(); };
    const up = (e) => { delete keys[e.code]; }, blur = clearKeys;
    WIN.addEventListener('keydown', down, true); WIN.addEventListener('keyup', up, true); WIN.addEventListener('blur', blur, false);
    listeners = [[WIN, 'keydown', down, true], [WIN, 'keyup', up, true], [WIN, 'blur', blur, false]];
  }
  function unbind() {
    for (let i = 0; i < listeners.length; i++) { const l = listeners[i]; try { l[0].removeEventListener(l[1], l[2], l[3]); } catch (_) {} }
    listeners = []; clearKeys();
  }
  function init(m) {
    map = m || map || (GTA.probe && GTA.probe.state && GTA.probe.state.map) || WIN.mapgl || null;
    return api;
  }
  function enter(m) {
    init(m);
    const ps = GTA.player && GTA.player.state;
    if (ps) { state.lng = num(ps.lng, state.lng); state.lat = num(ps.lat, state.lat); state.heading = num(ps.heading, num(ps.yaw, 0)); }
    state.active = true;
    Object.assign(state, { speed: 0, steer: 0, vx: 0, vy: 0, drift: 0, spin: 0, z: 0, wheelPhase: 0 });
    bind();
    try { map.setPitch(28, { duration: 0 }); map.setZoom(19.5, { duration: 0 }); } catch (_) {}
    try { doc.exitPointerLock?.(); } catch (_) {}
    if (ps) ps.mode = 'car';
    return api;
  }
  function exit() {
    state.active = false; unbind();
    const ps = GTA.player && GTA.player.state;
    if (ps) Object.assign(ps, { lng: state.lng, lat: state.lat, heading: state.heading, mode: 'foot', z: 0, speed: 0 });
    return api;
  }
  const toggle = () => (state.active ? exit() : enter()), isActive = () => !!state.active;
  function step(dt) {
    if (!state.active) return;
    const d = clamp(num(dt, 0), 0, 0.05); if (!d) return;
    const h = state.heading * D2R, fwdE = -Math.sin(h), fwdN = Math.cos(h), rightE = Math.cos(h), rightN = Math.sin(h);
    let vFwd = state.vx * fwdE + state.vy * fwdN, vLat = state.vx * rightE + state.vy * rightN;
    const thr = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    if (thr > 0) vFwd += ACCEL * d;
    else if (thr < 0) vFwd += (vFwd > 0 ? -BRAKE : -ACCEL) * d;
    else vFwd -= sign(vFwd) * Math.min(Math.abs(vFwd), COAST * d);
    vFwd = clamp(vFwd, REV, MAX_SPEED);
    const steerInput = (keys.KeyA || keys.ArrowLeft ? 1 : 0) - (keys.KeyD || keys.ArrowRight ? 1 : 0);
    const steerTarget = steerInput * STEER_MAX;
    state.steer += clamp(steerTarget - state.steer, -STEER_RATE * d, STEER_RATE * d);
    const wantDrift = keys.Space || (Math.abs(state.steer) > 0.35 && vFwd > 9) ? 1 : 0;
    state.drift = clamp(state.drift + clamp(wantDrift - state.drift, -3 * d, 3 * d), 0, 1);
    const grip = GRIP + (DRIFT_GRIP - GRIP) * state.drift;
    vLat *= Math.max(0, 1 - grip * d);
    const turnScale = clamp(Math.abs(vFwd) / 8, 0.35, 1);
    state.heading += (state.steer * 180 / Math.PI) * turnScale * 1.15 * d + vLat * 0.02 * state.drift * d;
    state.heading += state.spin * d;
    state.spin *= Math.max(0, 1 - 2.5 * d);
    state.heading = ((state.heading % 360) + 360) % 360;
    state.vx = fwdE * vFwd + rightE * vLat; state.vy = fwdN * vFwd + rightN * vLat;
    state.speed = vFwd; state.wheelPhase += vFwd * d * 1.6;
    const ext = GTA.collisionExtract, col = GTA.collision;
    const p = ext && typeof ext.lngLatToWorld === 'function' ? ext.lngLatToWorld(state.lng, state.lat) : null;
    const wpm = ext && typeof ext.wpmAtLat === 'function' ? num(ext.wpmAtLat(state.lat), 0) : 0;
    let supportZ = 0, hit = null, hitN = null, blocked = false;
    if (p && isFinite(p[0]) && isFinite(p[1]) && wpm > 0) {
      const hw = WID / 2 * wpm, hl = LEN / 2 * wpm, cA = state.heading * D2R;
      // fx = forward (heading direction) so hl (length) projects onto it; rx = right so hw (width) does.
      const fx = [-Math.sin(cA), Math.cos(cA)], rx = [Math.cos(cA), Math.sin(cA)];
      let cx = p[0] + state.vx * d * wpm, cy = p[1] + state.vy * d * wpm;
      const boxes = col && col.state && Array.isArray(col.state.boxes) ? col.state.boxes : [];
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i]; if (!b || !isFinite(b.wx) || !isFinite(b.wy) || !isFinite(b.hx) || !isFinite(b.hy) || !isFinite(b.cos) || !isFinite(b.sin) || !isFinite(b.h)) continue;
        const dx = cx - b.wx, dy = cy - b.wy, reach = hl + hw + b.hx + b.hy;
        if (dx * dx + dy * dy > reach * reach) continue;
        const bx = [b.cos, b.sin], by = [-b.sin, b.cos], axes = [fx, rx, bx, by];
        let minPen = Infinity, sepX = 0, sepY = 0, overlap = true;
        for (let a = 0; a < 4; a++) {
          const u = axes[a];
          const carExt = hl * Math.abs(fx[0] * u[0] + fx[1] * u[1]) + hw * Math.abs(rx[0] * u[0] + rx[1] * u[1]);
          const boxExt = b.hx * Math.abs(bx[0] * u[0] + bx[1] * u[1]) + b.hy * Math.abs(by[0] * u[0] + by[1] * u[1]);
          const pen = carExt + boxExt - Math.abs(dx * u[0] + dy * u[1]);
          if (pen <= 0) { overlap = false; break; }
          if (pen < minPen) { minPen = pen; sepX = u[0]; sepY = u[1]; }
        }
        if (!overlap) continue;
        if (b.kind === 'road') {
          if (b.h > supportZ && b.h - state.z < 1.5) supportZ = b.h;
          continue;
        }
        if (state.z < num(b.z0, 0)) continue;
        if (state.z <= b.h - 0.5) {
          const s = (dx * sepX + dy * sepY) >= 0 ? 1 : -1;
          cx += sepX * minPen * s; cy += sepY * minPen * s; hit = { kind: b.kind, sub: b.sub }; hitN = [sepX * s, sepY * s]; blocked = true;
        } else if (b.h > supportZ && state.z >= b.h - 0.5) supportZ = b.h;
      }
      // Ragdoll bounce: reflect the velocity off the wall normal and spin the body on impact.
      if (blocked && hitN) {
        const n = hitN, vn = state.vx * n[0] + state.vy * n[1];
        if (vn < 0) {
          const REST = 0.45, impact = -vn;
          state.vx -= (1 + REST) * vn * n[0]; state.vy -= (1 + REST) * vn * n[1];
          const cross = state.vx * n[1] - state.vy * n[0];
          state.spin += clamp(impact * 0.06, 0, 1.6) * (cross >= 0 ? 1 : -1);
          if (impact > 6) state.z = Math.max(state.z, Math.min((impact - 6) * 0.03, 0.5));
        }
        state.speed = Math.hypot(state.vx, state.vy);
      }
      const ll = typeof ext.worldToLngLat === 'function' ? ext.worldToLngLat(cx, cy) : null;
      if (ll && isFinite(ll[0]) && isFinite(ll[1])) { state.lng = ll[0]; state.lat = ll[1]; }
    }
    state.z = Math.max(supportZ, state.z - 12 * d);
    try { col && col.refresh && col.refresh(map, state.lng, state.lat); } catch (_) {}
    const ps = GTA.player && GTA.player.state;
    if (ps) {
      ps.lng = state.lng; ps.lat = state.lat; ps.heading = state.heading; ps.yaw = state.heading;
      ps.speed = Math.abs(state.speed); ps.z = state.z; ps.mode = 'car';
    }
    try {
      map.setCenter([state.lng, state.lat], { duration: 0 });
      map.setRotation(state.heading, { duration: 0 });
    } catch (_) {}
  }
  const api = { state, init, enter, exit, toggle, step, isActive };
  GTA.vehicle = api;
})(WIN, GTA);
