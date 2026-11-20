// GTA2GIS — Stage 4 boot sequence: on-foot + car wiring (concatenated last inside the userscript IIFE)
'use strict';

async function boot() {
  if (GTA._booted) return;
  GTA._booted = true;
  if (typeof WIN !== 'undefined' && WIN !== WIN.top) return;

  const onDomReady = (fn) => { if (document.readyState !== 'loading') fn(); else document.addEventListener('DOMContentLoaded', fn, { once: true }); };

  let map = null;
  let active = false;
  let rafId = 0;
  let lastTs = 0;
  let lastHud = 0;

  const stopLoop = () => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; };
  const startLoop = () => { if (rafId || !active) return; lastHud = lastTs = performance.now(); rafId = requestAnimationFrame(tick); };

  const tick = (ts) => {
    rafId = 0;
    if (!active || !map) return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    const isCar = !!(GTA.vehicle && GTA.vehicle.state.active);
    try {
      if (isCar) { GTA.vehicle.step(dt); } else { GTA.player.step(dt); }
      const view = isCar ? GTA.vehicle.state : GTA.player.state;
      GTA.playerGL?.setState?.(isCar ? { active: false } : GTA.player.state);
      GTA.vehicleGL?.setState?.(isCar ? GTA.vehicle.state : { active: false });
      GTA.overlay.render(map, view);
      map.triggerRerender?.();
    } catch (err) {
      console.warn('[GTA2GIS] frame error', err);
    }
    if (ts - lastHud > 100) {
      lastHud = ts;
      const s = GTA.player.state || {};
      GTA.hud.setTelemetry({
        mode: isCar ? 'CAR' : (s.mode || 'FOOT'),
        speed: s.speed || 0,
        z: s.z || 0,
        pitch: s.pitch,
        yaw: s.yaw,
        locked: !!s.pointerLocked,
        cols: GTA.collision?.state?.stats?.total || 0,
      });
    }
    rafId = requestAnimationFrame(tick);
  };

  const toggleMode = () => {
    if (!map) return;
    try {
      GTA.player.toggle();
    } catch (err) {
      console.warn('[GTA2GIS] toggle failed', err);
      return;
    }
    active = typeof GTA.player.isActive === 'function' ? !!GTA.player.isActive() : !active;
    GTA.hud.setActive(active, active ? 'FOOT' : 'OFF');
    if (active) {
      try { GTA.collision?.refresh?.(map, GTA.player.state.lng, GTA.player.state.lat, true); } catch (_) {}
      GTA.playerGL?.attach?.(map);
      GTA.vehicleGL?.attach?.(map);
      GTA.playerGL?.setState?.(GTA.player.state);
      startLoop();
      return;
    }
    stopLoop();
    if (GTA.vehicle && GTA.vehicle.state.active) GTA.vehicle.exit();
    GTA.vehicleGL?.setState?.({ active: false });
    GTA.playerGL?.setState?.(GTA.player.state);
    map.triggerRerender?.();
    try {
      if (typeof GTA.overlay.clear === 'function') GTA.overlay.clear();
      else if (typeof GTA.overlay.detach === 'function') GTA.overlay.detach();
    } catch (_) {}
  };

  const toggleDebug = () => {
    const col = GTA.collision;
    if (!col || typeof col.toggleDebug !== 'function') { GTA.hud.setInfo('Colliders not loaded'); return; }
    let on = null;
    try {
      const r = col.toggleDebug();
      on = r == null ? (col.state ? !!col.state.debug : null) : !!r;
    } catch (err) {
      console.warn('[GTA2GIS] collider debug toggle failed', err);
      return;
    }
    if (on != null) GTA.hud.setInfo('Collider debug: ' + (on ? 'ON' : 'OFF'));
  };

  const togglePrototype = () => {
    const st = GTA.player && GTA.player.state;
    if (!st || !st.active) { GTA.hud.setInfo('Prototype (P) works in on-foot mode — press G first.'); return; }
    const on = !st.prototype;
    if (GTA.player.setPrototype) GTA.player.setPrototype(on); else st.prototype = on;
    GTA.hud.setInfo(on ? 'Prototype ON: super speed + high jump. P to toggle.' : 'Prototype OFF.');
  };

  const onKeyDown = (ev) => {
    if (!ev || ev.repeat) return;
    const el = ev.target;
    if (el) {
      const tag = String(el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) return;
    }
    if (ev.code === 'KeyB') { toggleDebug(); return; }
    if (ev.code === 'KeyG') { toggleMode(); return; }
    if (ev.code === 'KeyP') { togglePrototype(); return; }
    const st = GTA.player.state || {}, veh = GTA.vehicle;
    if (ev.code === 'KeyF' && st.active && veh && !veh.state.active) {
      veh.enter(); GTA.hud.setInfo('Entered car. WASD drive, A/D steer, Space handbrake, E exit.'); return;
    }
    if (ev.code === 'KeyE' && veh && veh.state.active) { veh.exit(); GTA.hud.setInfo('Exited car. F to re-enter.'); }
  };

  onDomReady(() => {
    try {
      GTA.hud.mount();
    } catch (err) {
      console.error('[GTA2GIS] HUD mount failed', err);
    }
  });
  GTA.hud.setDumpHandler(() => GTA.probe.dump());
  GTA.hud.setStatus('WAITING 2GIS...', false);

  try {
    map = await GTA.probe.waitForMapGL(30000);
    if (!map) throw new Error('MAPGL unavailable');
    GTA.player.init(map);
    GTA.overlay.attach(map);
    GTA.vehicleGL?.attach?.(map);
    GTA.vehicle?.init?.(map);
    GTA.playerGL?.attach?.(map);
    GTA.hud.setToggleHandler(() => toggleMode());
    document.addEventListener('keydown', onKeyDown, true);
    GTA.hud.setStatus('MAPGL READY', true);
    GTA.hud.setInfo('Stage 5 ready. G play, F enter car, E exit, P prototype, B colliders.');
    console.log('[GTA2GIS] Stage 5 ready. G play, F enter car, E exit, P prototype, B colliders.');
  } catch (err) {
    GTA.hud.setStatus('MAPGL TIMEOUT', false);
    GTA.hud.setInfo('Open 2GIS map view and retry');
    console.warn('[GTA2GIS] waitForMapGL failed:', (err && err.message) || err);
  }

  GTA.toggle = toggleMode;
}

GTA.boot = boot;
boot();
