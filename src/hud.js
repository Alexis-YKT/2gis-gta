/* GTA // 2GIS — Stage 2 neon HUD: Vice City / Leonida glass panel. */
(function () {
  'use strict';
  var W = typeof WIN !== 'undefined' ? WIN : window;
  var G = typeof GTA !== 'undefined' && GTA ? GTA : (W.__GTA2GIS__ = W.__GTA2GIS__ || {});
  var STYLE_ID = 'gta2gis-hud-style', PANEL_ID = 'gta2gis-hud';
  var S = { mounted: false, collapsed: false, ready: false, active: false, label: 'WAIT MAP', info: 'idle', dump: null,
    toggle: null, mode: 'FOOT', speed: 0, z: 0, pitch: null, yaw: null, locked: false, cols: null }, E = {}, P = '#' + PANEL_ID + ' ';

  var CSS =
    '#' + PANEL_ID + '{position:fixed;top:14px;right:14px;z-index:999999;width:292px;padding:9px 11px 10px;'
    + 'font:12px/1.45 "Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#f4e9ff;background:#120816cc;border:1px solid rgba(255,46,151,.34);'
    + 'border-radius:10px;user-select:none;-webkit-backdrop-filter:blur(9px);backdrop-filter:blur(9px);box-shadow:0 0 0 1px rgba(0,0,0,.5),0 8px 24px rgba(0,0,0,.65),0 0 16px rgba(255,46,151,.22);}'
    + P + '*{box-sizing:border-box;}' + P + '.gta-h{display:flex;align-items:center;gap:7px;margin-bottom:6px;}'
    + P + '.gta-t{flex:1 1 auto;font-size:11px;font-weight:700;letter-spacing:.12em;color:#ff2e97;text-shadow:0 0 9px rgba(255,46,151,.65);white-space:nowrap;}'
    + P + '.gta-pill{font:600 9px/1 ui-monospace,Consolas,monospace;letter-spacing:.08em;padding:3px 6px;border-radius:999px;color:#ffb27a;border:1px solid rgba(255,157,46,.5);background:rgba(255,157,46,.13);white-space:nowrap;}'
    + P + '.gta-pill.ok{color:#00f0ff;border-color:rgba(0,240,255,.55);background:rgba(0,240,255,.12);text-shadow:0 0 8px rgba(0,240,255,.75);}'
    + P + '.gta-mini{flex:0 0 auto;cursor:pointer;font:700 12px/1 ui-monospace,monospace;color:#00f0ff;background:rgba(0,240,255,.08);border:1px solid rgba(0,240,255,.35);border-radius:6px;padding:2px 6px;}'
    + P + '.gta-mini:hover{background:rgba(0,240,255,.18);}' + P + '.gta-tel{font:9.5px/1.4 ui-monospace,Consolas,monospace;color:#7de9ff;margin:0 0 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + P + '.gta-info{font:10px/1.4 ui-monospace,Consolas,monospace;color:#a9b6ff;opacity:.82;margin:0 0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
    + P + '.gta-play{display:block;width:100%;cursor:pointer;font:800 11px/1 "Segoe UI",sans-serif;letter-spacing:.1em;padding:8px 0;margin-bottom:5px;border:1px solid rgba(0,240,255,.45);border-radius:7px;color:#04161a;background:#00f0ff;box-shadow:0 0 13px rgba(0,240,255,.5),inset 0 0 0 1px rgba(255,255,255,.25);transition:filter .12s,transform .06s;}'
    + P + '.gta-play:hover{filter:brightness(1.12);}' + P + '.gta-play:active{transform:translateY(1px);}'
    + P + '.gta-play.on{background:#ff2e97;color:#160610;border-color:rgba(255,46,151,.6);box-shadow:0 0 14px rgba(255,46,151,.62),inset 0 0 0 1px rgba(255,255,255,.22);}'
    + P + '.gta-btn{display:block;width:100%;cursor:pointer;font:700 10px/1 "Segoe UI",sans-serif;letter-spacing:.1em;padding:6px 0;border:0;border-radius:6px;color:#ffd7ec;background:rgba(255,46,151,.18);box-shadow:inset 0 0 0 1px rgba(255,46,151,.45);transition:filter .12s,transform .06s;}'
    + P + '.gta-btn:hover{filter:brightness(1.2);}' + P + '.gta-btn:active{transform:translateY(1px);}' + P + '.gta-btn.done{background:#00f0ff;color:#04161a;box-shadow:0 0 12px rgba(0,240,255,.6);}'
    + P + '.gta-keys{font:8.5px/1.4 ui-monospace,Consolas,monospace;color:#8fe9f5;opacity:.7;margin:7px 0 0;padding-top:6px;border-top:1px solid rgba(0,240,255,.18);}' + P + '.gta-keys.active{opacity:.95;color:#ffd9ee;}'
    + '#' + PANEL_ID + '.gta-min{width:172px;padding:7px 10px;}' + '#' + PANEL_ID + '.gta-min .gta-h{margin-bottom:0;}' + '#' + PANEL_ID + '.gta-min .gta-body{display:none;}';

  function txt(v) { return v == null ? '' : String(v); } function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  function copy(text) {
    try {
      var c = navigator.clipboard; if (!c || !c.writeText) return false;
      var p = c.writeText(text); if (p && p.catch) p.catch(function () {});
      return true;
    } catch (e) { return false; }
  }

  function build() {
    var d = document.createElement('div'); d.id = PANEL_ID;
    d.innerHTML = '<div class="gta-h"><span class="gta-t">GTA // 2GIS</span><span class="gta-pill">WAIT MAP</span>'
      + '<button class="gta-mini" type="button" title="Collapse">\u2014</button></div>'
      + '<div class="gta-body"><div class="gta-tel">OFF | 0.0 m/s | Z 0.0m | LOOK: FREE</div><div class="gta-info">idle</div>'
      + '<button class="gta-play" type="button">PLAY GTA (G)</button><button class="gta-btn" type="button">Dump 2GIS</button>'
      + '<div class="gta-keys">WASD move \u00b7 Shift run \u00b7 Space jump \u00b7 Click look \u00b7 Wheel zoom \u00b7 P proto \u00b7 B boxes \u00b7 G toggle</div></div>';
    ['mousedown', 'pointerdown', 'wheel', 'click'].forEach(function (ev) {
      d.addEventListener(ev, function (e) { e.stopPropagation(); }, false);
    });
    var q = function (s) { return d.querySelector(s); };
    E.panel = d; E.pill = q('.gta-pill'); E.tel = q('.gta-tel'); E.info = q('.gta-info'); E.keys = q('.gta-keys');
    E.play = q('.gta-play'); E.dump = q('.gta-btn'); E.mini = q('.gta-mini');
    E.dump.addEventListener('click', function (e) { e.stopPropagation(); onDump(); });
    E.play.addEventListener('click', function (e) { e.stopPropagation(); onToggle(); });
    E.mini.addEventListener('click', function (e) { e.stopPropagation(); toggleCollapsed(); });
    document.body.appendChild(d); return d;
  }

  function flash(text) {
    if (!E.dump) return;
    clearTimeout(E.timer); E.dump.textContent = text; E.dump.classList.add('done');
    E.timer = setTimeout(function () { E.dump.textContent = 'Dump 2GIS'; E.dump.classList.remove('done'); }, 1400);
  }
  function onDump() {
    var out, json = '';
    try { out = typeof S.dump === 'function' ? S.dump() : null; }
    catch (err) { console.error('[GTA // 2GIS] dump handler failed', err); flash('Error'); return; }
    if (!out || typeof out !== 'object') { flash('Dumped!'); console.log('[GTA // 2GIS] dump requested', out); return; }
    try { json = JSON.stringify(out); } catch (e) { json = ''; }
    var ok = json ? copy(json) : false;
    setInfo((ok ? 'copied ' : 'ready ') + json.length + ' B' + (ok ? ' \u00b7 paste to save' : ' \u00b7 clipboard blocked'));
    flash(ok ? 'Copied!' : 'Dumped!');
    console.log('[GTA // 2GIS] dump ' + json.length + 'B', out);
  }
  function onToggle() {
    if (typeof S.toggle !== 'function') { console.warn('[GTA // 2GIS] no toggle handler'); return; }
    try { S.toggle(!S.active); } catch (err) { console.error('[GTA // 2GIS] toggle handler failed', err); }
  }
  function renderTelemetry() {
    var line = (S.active ? (S.mode || 'FOOT') : 'OFF') + ' | ' + num(S.speed, 0).toFixed(1) + ' m/s | Z '
      + num(S.z, 0).toFixed(1) + 'm | LOOK: ' + (S.locked ? 'LOCKED' : 'FREE') + (S.cols != null ? ' | COL:' + num(S.cols, 0) : '');
    if (S.pitch != null && S.yaw != null) line += ' | P ' + num(S.pitch, 0).toFixed(1) + ' Y ' + num(S.yaw, 0).toFixed(1);
    if (E.tel) { E.tel.textContent = line; E.tel.title = line; }
    return api;
  }
  function applyActive() {
    if (!E.play) return;
    E.play.textContent = S.active ? 'EXIT GTA (G)' : 'PLAY GTA (G)';
    E.play.title = S.active ? 'Exit GTA (' + (S.mode || 'FOOT') + ') and release pointer lock' : 'Play GTA: first-person + pointer lock';
    E.play.classList.toggle('on', S.active);
    if (E.keys) E.keys.classList.toggle('active', S.active);
  }
  function setActive(isActive, modeLabel) {
    S.active = !!isActive;
    if (modeLabel != null) { var m = txt(modeLabel).toUpperCase(); if (m && m !== 'OFF') S.mode = m; }
    applyActive(); return renderTelemetry();
  }
  function setStatus(label, ok) {
    if (label != null) S.label = txt(label);
    if (ok != null) S.ready = !!ok;
    if (!E.pill) return api;
    E.pill.textContent = S.label || (S.ready ? 'MAP READY' : 'WAIT MAP');
    E.pill.className = 'gta-pill ' + (S.ready ? 'ok' : 'bad');
    return api;
  }
  function setInfo(text) {
    S.info = txt(text);
    if (E.info) E.info.textContent = S.info;
    return api;
  }
  function setTelemetry(o) {
    o = o && typeof o === 'object' ? o : {};
    if (o.mode != null) { var m = txt(o.mode).toUpperCase(); if (m) S.mode = m; }
    if (o.speed != null) S.speed = num(o.speed, 0); if (o.z != null) S.z = num(o.z, 0);
    if (o.pitch != null) S.pitch = num(o.pitch, 0); if (o.yaw != null) S.yaw = num(o.yaw, 0);
    if (o.locked != null) S.locked = !!o.locked; if (o.cols != null) S.cols = Math.max(0, Math.round(num(o.cols, 0)));
    return renderTelemetry();
  }
  function toggleCollapsed() {
    S.collapsed = !S.collapsed;
    if (E.panel) E.panel.classList.toggle('gta-min', S.collapsed);
    if (E.mini) { E.mini.textContent = S.collapsed ? '+' : '\u2014'; E.mini.title = S.collapsed ? 'Expand' : 'Collapse'; }
    return api;
  }
  function setDumpHandler(fn) { S.dump = typeof fn === 'function' ? fn : null; return api; }
  function setToggleHandler(fn) { S.toggle = typeof fn === 'function' ? fn : null; return api; }

  function mount() {
    if (S.mounted && E.panel && document.body && document.body.contains(E.panel)) return api;
    if (!document.body) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, false);
      else setTimeout(mount, 30);
      return api;
    }
    if (!document.getElementById(STYLE_ID)) {
      var st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    }
    E.panel = document.getElementById(PANEL_ID) || build();
    S.mounted = true;
    setStatus(S.label, S.ready); setInfo(S.info);
    applyActive(); renderTelemetry();
    return api;
  }

  var api = { mount: mount, setStatus: setStatus, setInfo: setInfo, setDumpHandler: setDumpHandler,
    setToggleHandler: setToggleHandler, setActive: setActive, setTelemetry: setTelemetry };

  G.hud = api;
})();
