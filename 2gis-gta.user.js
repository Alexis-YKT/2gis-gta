// ==UserScript==
// @name         GTA in 2GIS
// @namespace    https://2gis.ru/
// @version      0.5.0
// @description  GTA 6 style walking, driving, collisions, prototype mode & extended draw distance for 2GIS 3D map (Stage 5: Prototype mode, perf, fog, bridges)
// @match        https://2gis.ru/*
// @match        https://*.2gis.ru/*
// @match        https://2gis.com/*
// @match        https://*.2gis.com/*
// @match        https://2gis.kz/*
// @match        https://*.2gis.kz/*
// @match        https://2gis.kg/*
// @match        https://2gis.uz/*
// @match        https://2gis.ae/*
// @run-at       document-start
// @grant        unsafeWindow
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  const WIN = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  const GTA = (WIN.__GTA2GIS__ = WIN.__GTA2GIS__ || {});
  GTA.version = '0.5.0';

// --- src/probe.js ---
/* src/probe.js — passive 2GIS/MapGL probe. Never defines window.mapgl. */
(function (WIN, GTA) {
  'use strict';
  const state = { glContexts: [], map: null, hooked: false };
  const safe = (fn, fb) => { try { const v = fn(); return v === undefined ? fb : v; } catch (e) { return fb; } };
  const call = (o, k, ...a) => safe(() => o && typeof o[k] === 'function' ? o[k](...a) : undefined, undefined);
  function installWebGLHook() {
    try {
      const p = WIN.HTMLCanvasElement && WIN.HTMLCanvasElement.prototype;
      if (!p || state.hooked || (p.getContext && p.getContext.__gtaHook) || typeof p.getContext !== 'function') return state;
      const o = p.getContext;
      const h = function getContext(t) {
        const a = arguments, ctx = o.apply(this, a);
        try {
          if (ctx && /^(webgl2?|experimental-webgl)$/.test(t)) state.glContexts.push({ canvas: this, gl: ctx,
            type: t === 'experimental-webgl' ? 'webgl' : t, attrs: safe(() => ctx.getContextAttributes(), a[1] || null), createdAt: Date.now() });
        } catch (e) {}
        return ctx;
      };
      h.__gtaHook = true;
      const d = Object.getOwnPropertyDescriptor(p, 'getContext') || {};
      Object.defineProperty(p, 'getContext', { value: h, writable: d.writable !== false, configurable: d.configurable !== false, enumerable: !!d.enumerable });
      state.hooked = true;
    } catch (e) {}
    return state;
  }

  function waitForMapGL(timeoutMs = 30000) {
    return new Promise((resolve) => {
      const t0 = Date.now(); let timer = 0;
      const check = () => {
        try {
          const m = WIN.mapgl;
          if (m && m._impl && m._impl.core && typeof m.project === 'function') { state.map = m; clearInterval(timer); resolve(m); return true; }
        } catch (e) {}
        if (Date.now() - t0 >= timeoutMs) { clearInterval(timer); resolve(null); return true; }
        return false;
      };
      if (!check()) timer = setInterval(check, 150);
    });
  }

  function sublayerIndex(style) {
    const out = {};
    try {
      for (const L of (style && style.layers) || []) {
        const subs = new Set(), walk = (n) => {
          if (!n || typeof n !== 'object') return;
          if (n.type === 'match' && Array.isArray(n.cases) && n.input && n.input.property === 'db_sublayer')
            for (const c of n.cases) if (c.values instanceof Set) c.values.forEach((v) => subs.add(v));
          for (const k in n) walk(n[k]);
        };
        walk(L.filter); out[L.innerId] = [...subs];
      }
    } catch (e) {}
    return out;
  }

  function dump2GIS() {
    const out = { timestamp: new Date().toISOString(), url: safe(() => WIN.location.href, ''), dpr: WIN.devicePixelRatio || 1,
      viewport: [WIN.innerWidth, WIN.innerHeight], glContexts: { count: 0, contexts: [] }, mapFound: false, camera: {},
      canvases: [], modules: [], style: {}, tiles: [], gltfBuckets: { items: [], totalBuckets: 0, totalInstances: 0 }, collisionInfo: null, methodsCheck: {} };
    try {
      const map = state.map || WIN.mapgl || null, impl = map && map._impl, md = impl && impl.core && impl.core.modules;
      const tm = md && md.tileManager, sm = md && md.styleManager;
      const gl = call(map, 'getWebGLContext'), center = call(map, 'getCenter') || null, pm = call(map, 'getProjectionMatrix'), pmArr = pm && pm.length ? Array.from(pm) : [];
      const tls = () => tm && Array.isArray(tm.tileLayers) ? tm.tileLayers : [];
      out.mapFound = !!(map && impl && impl.core && typeof map.project === 'function');
      out.glContexts.count = state.glContexts.length;
      out.glContexts.contexts = state.glContexts.map((c) => { const r = safe(() => c.canvas.getBoundingClientRect(), null);
        return { type: c.type, width: c.canvas.width, height: c.canvas.height, isMapGL: !!gl && c.gl === gl, attrs: c.attrs || null,
          cssW: r ? Math.round(r.width) : safe(() => c.canvas.clientWidth, null), cssH: r ? Math.round(r.height) : safe(() => c.canvas.clientHeight, null), createdAt: c.createdAt }; });
      out.camera = { center, zoom: call(map, 'getZoom'), styleZoom: call(map, 'getStyleZoom'), rotation: call(map, 'getRotation'), pitch: call(map, 'getPitch'), size: call(map, 'getSize'), bounds: call(map, 'getBounds'),
        viewportPadding: impl && impl.state ? impl.state.viewport : null, projMatrixSample: pmArr.length ? { first4: pmArr.slice(0, 4), last4: pmArr.slice(-4) } : null,
        centerProjected: center ? safe(() => map.project(center), null) : null, elevationAtCenter: null };
      try { out.camera.elevationAtCenter = center && typeof map.getElevationAtTier === 'function' ? map.getElevationAtTier(center, 0) ?? null : 'unavailable'; }
      catch (e) { out.camera.elevationAtCenter = 'error: ' + (e && e.message || String(e)); }
      out.canvases = safe(() => Array.from(WIN.document.querySelectorAll('canvas')).map((c) => { const r = c.getBoundingClientRect(), p = c.parentElement;
        return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height), display: WIN.getComputedStyle(c).display,
          parentTag: p ? p.tagName.toLowerCase() : null, parentPos: p ? WIN.getComputedStyle(p).position : null }; }), []);
      out.modules = md ? Object.keys(md).sort() : [];
      const style = safe(() => sm && typeof sm.getStyle === 'function' ? sm.getStyle(1) : null, null);
      let st = safe(() => map && typeof map.getStyleState === 'function' ? map.getStyleState() : null, null);
      if (!st) for (const tl of tls()) {
        const tiles = tl.gridState && tl.gridState.tiles || {};
        const hit = Object.keys(tiles).find((k) => tiles[k].currentMod && tiles[k].currentMod.params && tiles[k].currentMod.params.styleState);
        if (hit) { st = tiles[hit].currentMod.params.styleState; break; }
      }
      out.style = { graphicsPreset: st ? st.graphicsPreset : null, styleState: st || null, layersCount: style && style.layers ? style.layers.length : null,
        hasCustomLayers: sm ? safe(() => typeof sm.hasCustomLayers === 'function' ? !!sm.hasCustomLayers() : undefined, null) : null, customLayersCount: sm && sm.customLayers ? safe(() => sm.customLayers.size, null) : null };
      out.tiles = safe(() => tls().map((tl) => {
        const tiles = tl.gridState && tl.gridState.tiles || {}, keys = Object.keys(tiles);
        return { id: tl.id, tileCount: keys.length, readyCount: keys.filter((k) => tiles[k].currentMod && tiles[k].currentMod.ready).length, sampleKeys: keys.slice(0, 3) };
      }), []);
      const subs = sublayerIndex(style), groups = new Map();
      const add = (id, bbox) => {
        let g = groups.get(id);
        if (!g) groups.set(id, g = { layerId: id, sublayer: (subs[id] || [])[0] || null, buckets: 0, instances: 0, sampleBbox: null });
        g.buckets++; if (g.sampleBbox === null && bbox) g.sampleBbox = bbox;
      };
      safe(() => {
        for (const tl of tls()) { const tiles = tl.gridState && tl.gridState.tiles || {};
          for (const k in tiles) for (const obj of (tiles[k].currentMod && tiles[k].currentMod.objects) || []) {
            if (obj.visible === false) continue;
            for (const c of obj.children || []) {
              if (!c || c.visible === false || !c.instanceCount || !c.layerSettings || c.layerSettings.programName !== 'gltfModel') continue;
              const a = c.attributes || {}; if (a.layerId == null) continue;
              add(a.layerId, c.bbox || null); groups.get(a.layerId).instances += c.instanceCount;
            }
          }
        }
      }, null);
      const all = [...groups.values()];
      out.gltfBuckets = { items: all.slice().sort((a, b) => b.instances - a.instances).slice(0, 20), totalBuckets: all.reduce((s, g) => s + g.buckets, 0), totalInstances: all.reduce((s, g) => s + g.instances, 0) };
      out.collisionInfo = (() => { try {
        const wpm = 4294967296 / (40075017 * Math.cos(((center && center.lat) || 0) * Math.PI / 180)), S = [], C = { n: 0 }, counts = {}, samples = []; let gltf = null;
        for (const tl of tls()) for (const k in ((tl.gridState && tl.gridState.tiles) || {})) for (const obj of ((tl.gridState.tiles[k].currentMod && tl.gridState.tiles[k].currentMod.objects) || [])) if (obj.visible !== false) for (const c of obj.children || []) {
          if (!c || c.visible === false) continue;
          const a = c.attributes || {}, pn = c.layerSettings && c.layerSettings.programName, isGltf = pn === 'gltfModel';
          if (isGltf) { if (c.instanceCount && !gltf) gltf = c; } else { const key = pn || 'null'; counts[key] = (counts[key] || 0) + 1;
            if (samples.length < 3 && !c.bboxWorld && (a.layerId != null || a.buildingId != null)) samples.push({ programName: pn || null, keys: Object.keys(c), bbox: c.bbox || null, bboxWorld: c.bboxWorld || null }); }
          if (!c.bboxWorld || (isGltf && c.instanceCount)) continue;
          if (++C.n <= 5) { const b = c.bboxWorld, mn = b.min || b[0], mx = b.max || b[1], mm = (i) => Math.round((mx[i] - mn[i]) * wpm);
            S.push({ programName: pn || null, layerId: a.layerId ?? null, sublayer: a.sublayer ?? a.db_sublayer ?? (subs[a.layerId] || [])[0] ?? null, sizeM: [mm(0), mm(1), mm(2)], buildingId: a.buildingId ?? a.building_id ?? null }); } }
        const gi = (() => { const o = gltf; if (!o) return null; const M = o.renderModelMatrix, va = o.vao && o.vao._attributes, pa = va && va.a_vec3_instance_position, buf = pa && pa._buffer;
          return { objKeys: Object.keys(o).filter((x) => /matrix|bbox|model|vis/i.test(x)), hasRenderM: !!M, mSample: M && M.length > 13 ? [M[0], M[5], M[12], M[13]] : null, vaoAttrKeys: va ? Object.keys(va) : null,
            posAttr: pa ? { stride: pa.stride ?? null, offset: pa.offset ?? null, bufKeys: buf ? Object.keys(buf) : null, hasGl: !!pa._gl, hasGlBuf: !!(buf && buf._gl) } : null, bboxWorld: o.bboxWorld || null }; })();
        return { meshBuildingSamples: { count: C.n, samples: S }, activeColliders: GTA.collision?.state?.stats || null, gltfInspect: gi,
          nonGltfPrograms: { counts, samples }, cameraLimits: { maxPitch: map?.getMaxPitch?.(), maxZoom: map?.getMaxZoom?.(), padding: map?.getPadding?.() } };
      } catch (e) { return { error: 'collisionInfo: ' + (e && e.message || String(e)) }; } })();
      const methods = ['setCenter', 'setPitch', 'setRotation', 'setZoom', 'project', 'unproject', 'addLayer', 'blockInteraction', 'getWebGLContext', 'getCanvas', 'getGroundPoint', 'getElevationAtTier'];
      for (const n of methods) out.methodsCheck[n] = !!(map && typeof map[n] === 'function');
    } catch (e) { out.error = 'dump failed: ' + (e && e.message || String(e)); }
    try { const c = WIN.console; c.groupCollapsed('[GTA2GIS] ' + out.timestamp);
      c.log('map:', out.mapFound, 'center:', out.camera.center, 'zoom:', out.camera.zoom, 'gl:', out.glContexts.count, 'canvases:', out.canvases.length);
      c.log('tiles:', out.tiles.length, 'gltf:', out.gltfBuckets.totalBuckets, 'buckets /', out.gltfBuckets.totalInstances, 'instances');
      c.log('missing methods:', Object.keys(out.methodsCheck).filter((k) => !out.methodsCheck[k])); c.log('collisionInfo:', out.collisionInfo); c.groupEnd();
    } catch (e) {}
    return out;
  }

  GTA.probe = { state, installWebGLHook, waitForMapGL, dump: dump2GIS };
  GTA.dump = dump2GIS;
  try { WIN.__GTA2GIS_DUMP__ = dump2GIS; } catch (e) {}
  installWebGLHook();
})(typeof WIN !== 'undefined' ? WIN : window,
  typeof GTA !== 'undefined' ? GTA : ((typeof WIN !== 'undefined' ? WIN : window).__GTA2GIS__ =
    (typeof WIN !== 'undefined' ? WIN : window).__GTA2GIS__ || {}));

// --- src/collision-extract.js ---
/* src/collision-extract.js - 2GIS colliders: instanced GLB, extrusion walls, bbox meshes. */
(function (WIN, GTA) { 'use strict';
const W2 = 4294967296, M_PER_DEG = 40075016.686, D2R = Math.PI / 180, DEF = 64;
const lngLatToWorld = (lng, lat) => [lng / 360 * W2, Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2)) / (2 * Math.PI) * W2];
const worldToLngLat = (wx, wy) => [wx / W2 * 360, (2 * Math.atan(Math.exp(wy / W2 * 2 * Math.PI)) - Math.PI / 2) / D2R];
const wpmAtLat = (lat) => W2 / (M_PER_DEG * Math.max(1e-6, Math.abs(Math.cos(lat * D2R))));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v), finite = (...v) => v.every((x) => typeof x === 'number' && isFinite(x));
const KINDS = [[/tree|shrub|bush|plant/i, 'tree'], [/lamp|light/i, 'lamp'], [/fence|barrier/i, 'fence'], [/bench|table|swing|chair/i, 'bench'], [/house|building|immersive|sight|kiosk|porch|canopy|wall|support|column/i, 'building']];
const ELIGIBLE = /house|building|immersive_model|low_zoom_sight|kiosk|barrier|fence|porch|bridge|overpass|underpass|tunnel|embankment|overground/i, WALL_PROG = /^(diffuse|gradientDiffuse|wallTexture)$/;
const ROAD_PROG = /^mesh$/, ROAD_RE = /roadbed|bridge|overpass|overground|embankment|viaduct|flyover|underpass|tunnel|transport/i;
const BUILD_RE = /house|building|immersive_model|low_zoom_sight|kiosk/i;
const kindOf = (s) => (KINDS.find((k) => k[0].test(s)) || [0, 'prop'])[1];
let readUsed = 0, budgetHit = false; const READ_BUDGET = 6 * 1024 * 1024;
let subCache = null, subLayers = null; const bufCache = new WeakMap();
const tileCache = new Map(), TILE_CACHE_MAX = 700;
function subIndex(map) {
  let layers = null; try { layers = map._impl.core.modules.styleManager.getStyle(1).layers || []; } catch (_) { layers = []; }
  if (subCache && subLayers === layers) return subCache;
  const idx = Object.create(null), seen = new WeakSet();
  const walk = (n, out) => { if (!n || typeof n !== 'object' || seen.has(n)) return; seen.add(n);
    if (n.input && n.input.property === 'db_sublayer' && n.cases) for (const c of n.cases) { const v = c && c.values;
      if (v instanceof Set) v.forEach((x) => out.push(x)); else if (Array.isArray(v)) out.push(...v); }
    for (const k in n) walk(n[k], out); };
  for (const L of layers) { if (!L || typeof L !== 'object') continue; const out = []; walk(L.filter, out);
    if (typeof L.sublayer === 'string') out.push(L.sublayer);
    if (out.length) for (const id of [L.innerId, L.id]) if (id != null) idx[id] = Array.from(new Set(out)); }
  subCache = idx; subLayers = layers; return idx; }
const subOf = (c, idx) => (c.meta && typeof c.meta.sublayer === 'string' && c.meta.sublayer) || (idx[c.attributes && c.attributes.layerId] || ['?'])[0];
function readBuf(buf, byteOffset, byteLen, gl0) {
  if (!buf || typeof buf !== 'object') return null;
  const b0 = buf._glBuffer || buf.glBuffer || buf.buffer || buf._buffer, b = (b0 && (b0._glBuffer || b0.glBuffer || b0.buffer)) || b0, key = b || buf;
  let u8 = bufCache.get(key);
  if (!u8) { try {
    const src = buf._data || buf.data || (buf._buffer && (buf._buffer._data || buf._buffer.data));
    if (src && (src.byteLength || src.length)) u8 = src instanceof Uint8Array ? src : src.buffer ? new Uint8Array(src.buffer, src.byteOffset || 0, src.byteLength) : new Uint8Array(src);
    else {
      const gl = buf._gl || gl0; if (!gl || !b || typeof gl.getBufferSubData !== 'function') return null;
      const prev = gl.getParameter(gl.ARRAY_BUFFER_BINDING); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      let size = buf.byteLength || buf.size || b.byteLength || 0;
      if (!(size > 0) && typeof gl.getBufferParameter === 'function') size = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) | 0;
      if (!(size > 0)) size = byteOffset + byteLen; if (size < byteOffset + byteLen) size = byteOffset + byteLen;
      if (size > READ_BUDGET * 2) { gl.bindBuffer(gl.ARRAY_BUFFER, prev); return null; }
      if (readUsed + size > READ_BUDGET) { budgetHit = true; gl.bindBuffer(gl.ARRAY_BUFFER, prev); return null; }
      readUsed += size;
      u8 = new Uint8Array(size); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, u8); gl.bindBuffer(gl.ARRAY_BUFFER, prev);
    }
  } catch (_) { return null; }
    if (!u8 || !u8.byteLength) return null; bufCache.set(key, u8); }
  if (byteOffset >= u8.byteLength) return null;
  return new DataView(u8.buffer, u8.byteOffset + byteOffset, Math.min(byteLen, u8.byteLength - byteOffset)); }
function push(out, wx, wy, hx, hy, cos, sin, h, kind, sub, cx, cy, rW, z0) {
  if (!finite(wx, wy, hx, hy, h) || hx <= 0 || hy <= 0 || Math.hypot(wx - cx, wy - cy) > rW) return 0;
  const box = { wx, wy, hx, hy, cos, sin, h, kind, sub }; if (finite(z0) && z0 > 0.01) box.z0 = z0;
  out.push(box); return 1; }
function fromMesh(c, idx, out, cx, cy, rW, wpm) {
  const b = c.bboxWorld, mn = b && b.min, mx = b && b.max;
  if (!mn || !mx || !finite(mn[0], mn[1], mn[2], mx[0], mx[1], mx[2])) return 0;
  const sub = subOf(c, idx), prog = (c.layerSettings && c.layerSettings.programName) || '', bid = c.meta && c.meta.buildingId;
  if (!(ELIGIBLE.test(sub) || (bid && String(bid) !== '-1') || (/gltfModel/i.test(prog) && !c.instanceCount))) return 0;
  const dx = mx[0] - mn[0], dy = mx[1] - mn[1];
  if (!(dx > 0) || !(dy > 0) || dx > 180 * wpm || dy > 180 * wpm) return 0;
  const z0 = Math.max(0, mn[2] / wpm), top = Math.max(mx[2] / wpm, z0 + 0.6);
  return push(out, (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, dx / 2, dy / 2, 1, 0, top, sub === '?' ? 'building' : kindOf(sub), sub, cx, cy, rW, z0); }
function fromWalls(c, M, sub, out, cx, cy, rW, wpm, gl) {
  if (!M || !finite(M[0], M[5], M[10], M[12], M[13])) return 0;
  const A = c.vao && c.vao._attributes, at = A && A.a_vec2_vertex; if (!at) return 0;
  const opt = at.options || at, stride = opt.stride || 28, count = c.count | 0, start = c.start | 0;
  const xOff = opt.offset || 0, zAt = A.a_float_z, zo = zAt && (zAt.options || zAt);
  const zSep = !!(zAt && (zAt._buffer || zAt) !== (at._buffer || at)), zOff = zSep ? (zo && zo.offset) || 0 : ((zo && zo.offset) ?? (xOff + 4));
  const zStride = zSep ? (zo && zo.stride) || 4 : stride;
  if (!(count > 2) || stride < 8 || xOff + 4 > stride || (!zSep && (zOff < 0 || zOff + 4 > stride))) return 0;
  const dv = readBuf(at._buffer || at, start * stride, count * stride, gl); if (!dv) return 0;
  const dvz = zSep ? readBuf(zAt._buffer || zAt, start * zStride, count * zStride, gl) : dv; if (!dvz) return 0;
  const nV = Math.min(count, (dv.byteLength / stride) | 0); if (!(nV > 2)) return 0;
  const zS = M[10] || M[0] * 8, keys = new Set();
  const V = (i) => { const o = i * stride, oz = zSep ? i * zStride : o; return [M[12] + dv.getUint16(o + xOff, true) / 65535 * M[0], M[13] + dv.getUint16(o + xOff + 2, true) / 65535 * M[5], dvz.getFloat32(oz + zOff, true) * zS / wpm]; };
  let got = 0;
  for (let i = 0; i + 2 < nV; i += 3) {
    const p = [V(i), V(i + 1), V(i + 2)]; let best = null, bestDz = Infinity, bestLen = 0;
    for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const len = Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1]); if (len <= 0.25 * wpm || len >= 160 * wpm) continue;
      const dz = Math.abs(p[a][2] - p[b][2]);
      if (dz < bestDz - 1e-6 || (Math.abs(dz - bestDz) <= 1e-6 && len > bestLen)) { best = [a, b]; bestDz = dz; bestLen = len; } }
    if (!best) continue;
    const q0 = p[best[0]], q1 = p[best[1]], len = bestLen, mx = (q0[0] + q1[0]) / 2, my = (q0[1] + q1[1]) / 2, dx = q1[0] - q0[0], dy = q1[1] - q0[1];
    let ang = Math.atan2(dy, dx); ang = ((ang % Math.PI) + Math.PI) % Math.PI;
    const key = Math.round(mx / wpm * 2) + ',' + Math.round(my / wpm * 2) + ',' + Math.round(ang * 8);
    if (keys.has(key)) continue; keys.add(key);
    let maxH = Math.max(p[0][2], p[1][2], p[2][2]); if (maxH < 1.0) continue; maxH = clamp(maxH, 1.5, 250);
    got += push(out, mx, my, len / 2 + 0.15 * wpm, 0.3 * wpm, dx / len, dy / len, maxH, 'building', sub || 'Building_wall', cx, cy, rW + len / 2); }
  return got; }
function triDecode(c, M, gl, wpm, zScaleMode) {
  const A = c.vao && c.vao._attributes, at = A && A.a_vec2_vertex; if (!at) return null;
  const opt = at.options || at, stride = opt.stride || 24, count = c.count | 0, start = c.start | 0, xOff = opt.offset || 0;
  if (!(count > 2) || stride < 8 || count * stride > 8 * 1024 * 1024) return null;
  const zAt = A.a_float_z, zo = zAt && (zAt.options || zAt);
  const zSep = !!(zAt && (zAt._buffer || zAt) !== (at._buffer || at));
  const zOff = zSep ? (zo && zo.offset) || 0 : ((zo && zo.offset != null) ? zo.offset : (xOff + 4));
  const zStride = zSep ? (zo && zo.stride) || 4 : stride;
  const dv = readBuf(at._buffer || at, start * stride, count * stride, gl); if (!dv) return null;
  const dvz = zSep ? readBuf(zAt._buffer || zAt, start * zStride, count * zStride, gl) : dv; if (!dvz) return null;
  const nV = Math.min(count, (dv.byteLength / stride) | 0); if (!(nV > 2)) return null;
  const zS = zScaleMode ? (M[10] || M[0] * 8) : wpm;
  return { stride, zStride, zSep, xOff, zOff, dv, dvz, nV, zS, M0: M[0], M5: M[5], M12: M[12], M13: M[13] };
}
function fromRoof(c, M, sub, out, cx, cy, rW, wpm, gl) {
  const t = triDecode(c, M, gl, wpm, true); if (!t) return 0;
  const keys = new Set(); let got = 0;
  const V = (i) => { const o = i * t.stride, oz = t.zSep ? i * t.zStride : o;
    return [t.M12 + t.dv.getUint16(o + t.xOff, true) / 65535 * t.M0, t.M13 + t.dv.getUint16(o + t.xOff + 2, true) / 65535 * t.M5, t.dvz.getFloat32(oz + t.zOff, true) * t.zS / wpm]; };
  for (let i = 0; i + 2 < t.nV; i += 3) {
    const p = [V(i), V(i + 1), V(i + 2)];
    const h = Math.max(p[0][2], p[1][2], p[2][2]); if (!(h > 1.2)) continue;
    const xs = [p[0][0], p[1][0], p[2][0]], ys = [p[0][1], p[1][1], p[2][1]];
    const mx = (Math.min(xs[0], xs[1], xs[2]) + Math.max(xs[0], xs[1], xs[2])) / 2, my = (Math.min(ys[0], ys[1], ys[2]) + Math.max(ys[0], ys[1], ys[2])) / 2;
    const hx = (Math.max(xs[0], xs[1], xs[2]) - Math.min(xs[0], xs[1], xs[2])) / 2, hy = (Math.max(ys[0], ys[1], ys[2]) - Math.min(ys[0], ys[1], ys[2])) / 2;
    const key = Math.round(mx / wpm) + ',' + Math.round(my / wpm) + ',' + Math.round(h);
    if (keys.has(key)) continue; keys.add(key);
    got += push(out, mx, my, Math.max(hx, 0.4 * wpm), Math.max(hy, 0.4 * wpm), 1, 0, clamp(h, 1.5, 400), 'building', sub || 'Building_roof', cx, cy, rW + Math.max(hx, hy));
  }
  return got; }
function fromRoad(c, M, sub, out, cx, cy, rW, wpm, gl) {
  const t = triDecode(c, M, gl, wpm, false); if (!t) return 0;
  const keys = new Set(); let got = 0;
  const V = (i) => { const o = i * t.stride, oz = t.zSep ? i * t.zStride : o;
    return [t.M12 + t.dv.getUint16(o + t.xOff, true) / 65535 * t.M0, t.M13 + t.dv.getUint16(o + t.xOff + 2, true) / 65535 * t.M5, t.dvz.getFloat32(oz + t.zOff, true) / wpm]; };
  for (let i = 0; i + 2 < t.nV; i += 3) {
    const p = [V(i), V(i + 1), V(i + 2)];
    const h = Math.max(p[0][2], p[1][2], p[2][2]); if (!(h > 0.6)) continue;
    const xs = [p[0][0], p[1][0], p[2][0]], ys = [p[0][1], p[1][1], p[2][1]];
    const mx = (Math.min(xs[0], xs[1], xs[2]) + Math.max(xs[0], xs[1], xs[2])) / 2, my = (Math.min(ys[0], ys[1], ys[2]) + Math.max(ys[0], ys[1], ys[2])) / 2;
    const hx = (Math.max(xs[0], xs[1], xs[2]) - Math.min(xs[0], xs[1], xs[2])) / 2, hy = (Math.max(ys[0], ys[1], ys[2]) - Math.min(ys[0], ys[1], ys[2])) / 2;
    const key = Math.round(mx / wpm * 2) + ',' + Math.round(my / wpm * 2) + ',' + Math.round(h);
    if (keys.has(key)) continue; keys.add(key);
    got += push(out, mx, my, Math.max(hx, 0.5 * wpm), Math.max(hy, 0.5 * wpm), 1, 0, h + 0.1, 'road', sub || 'Roadbed', cx, cy, rW + Math.max(hx, hy), Math.max(0, h - 0.5));
  }
  return got; }
function fromWater(c, M, sub, out, cx, cy, rW, wpm, gl) {
  if (!M || !finite(M[0], M[5], M[12], M[13])) return 0;
  const A = c.vao && c.vao._attributes, at = A && (A.a_vec3_vertex || A.a_vec2_vertex); if (!at) return 0;
  const opt = at.options || at, stride = opt.stride || 0, count = c.count | 0, start = c.start | 0, xOff = opt.offset || 0;
  if (!(count > 2) || !(stride >= 6) || count * stride > 4 * 1024 * 1024 || xOff < 0 || xOff + 4 > stride) return 0;
  const dv = readBuf(at._buffer || at, start * stride, count * stride, gl); if (!dv) return 0;
  const nV = Math.min(count, (dv.byteLength / stride) | 0); if (!(nV > 2)) return 0;
  const keys = new Set(); let got = 0;
  const V = (i) => { const o = i * stride + xOff;
    return [M[12] + dv.getUint16(o, true) / 65535 * M[0], M[13] + dv.getUint16(o + 2, true) / 65535 * M[5]]; };
  for (let i = 0; i + 2 < nV; i += 3) {
    const p = [V(i), V(i + 1), V(i + 2)];
    const xs = [p[0][0], p[1][0], p[2][0]], ys = [p[0][1], p[1][1], p[2][1]];
    const mx = (Math.min(xs[0], xs[1], xs[2]) + Math.max(xs[0], xs[1], xs[2])) / 2, my = (Math.min(ys[0], ys[1], ys[2]) + Math.max(ys[0], ys[1], ys[2])) / 2;
    const hx = (Math.max(xs[0], xs[1], xs[2]) - Math.min(xs[0], xs[1], xs[2])) / 2, hy = (Math.max(ys[0], ys[1], ys[2]) - Math.min(ys[0], ys[1], ys[2])) / 2;
    const key = Math.round(mx / (8 * wpm)) + ',' + Math.round(my / (8 * wpm));
    if (keys.has(key)) continue; keys.add(key);
    got += push(out, mx, my, Math.max(hx, 0.5 * wpm), Math.max(hy, 0.5 * wpm), 1, 0, 0, 'water', sub, cx, cy, rW + Math.max(hx, hy));
  }
  return got; }
function fromGltf(c, M, idx, out, cx, cy, rW, wpm, gl) {
  const A = c && c.vao && c.vao._attributes, n = c && c.instanceCount | 0, at = A && A.a_vec3_instance_position;
  if (!at || !n) return fromMesh(c, idx, out, cx, cy, rW, wpm);
  const po = at.options || at, stride = po.stride || DEF, pOff = po.offset || 0;
  const mAt = A.a_mat3_instance_matrix, mo = mAt && (mAt.options || mAt), mOff = mo ? (mo.offset ?? 8) : 8;
  const hAt = A.a_float_instance_height, ho = hAt && (hAt.options || hAt), hOff = ho ? (ho.offset ?? 48) : -1;
  if (stride * n > 67108864 || stride < Math.max(pOff + 4, mOff + 32)) return fromMesh(c, idx, out, cx, cy, rW, wpm);
  const dv = readBuf(at._buffer || at, 0, stride * n, gl); if (!dv) return fromMesh(c, idx, out, cx, cy, rW, wpm);
  const b = c.bbox, mn = b && b.min, mx = b && b.max, mok = finite(mn && mn[0], mn && mn[1], mn && mn[2], mx && mx[0], mx && mx[1], mx && mx[2]);
  const hxM = mok ? (mx[0] - mn[0]) / 2 : 0.5, hzM = mok ? (mx[2] - mn[2]) / 2 : 0.5, hM = mok ? mx[1] - mn[1] : 3, cxM = mok ? (mn[0] + mx[0]) / 2 : 0, czM = mok ? (mn[2] + mx[2]) / 2 : 0;
  if (!finite(M && M[0], M && M[5], M && M[12], M && M[13]) || !M[0] || !M[5]) return fromMesh(c, idx, out, cx, cy, rW, wpm);
  const sub = subOf(c, idx), kind = kindOf(sub); let got = 0;
  if (kind === 'building' && c.bboxWorld && n <= 4) return fromMesh(c, idx, out, cx, cy, rW, wpm);
  for (let i = 0, nV = Math.min(n, (dv.byteLength / stride) | 0); i < nV; i++) {
    const base = i * stride, o16 = base + pOff, mB = base + mOff, hB = hOff >= 0 && hOff + 4 <= stride ? base + hOff : -1;
    const wx = M[12] + dv.getUint16(o16, true) / 65535 * M[0], wy = M[13] + dv.getUint16(o16 + 2, true) / 65535 * M[5];
    if (!finite(wx, wy)) continue;
    const m00 = dv.getFloat32(mB, true), m01 = dv.getFloat32(mB + 4, true), m20 = dv.getFloat32(mB + 24, true), m21 = dv.getFloat32(mB + 28, true);
    const l0 = Math.hypot(m00, m01), rot = finite(m00, m01, m20, m21) && l0 > 0;
    const vert = rot ? Math.hypot(dv.getFloat32(mB + 12, true), dv.getFloat32(mB + 16, true), dv.getFloat32(mB + 20, true)) / wpm || 1 : 1;
    const hv = hB >= 0 ? dv.getFloat32(hB, true) : 0; let bx = wx, by = wy, hx, hy, cos = 1, sin = 0;
    if (kind === 'tree' || kind === 'lamp') { const r = kind === 'tree' ? clamp(Math.max(hxM, hzM) * 0.08, 0.25, 0.55) : clamp(Math.min(hxM, hzM), 0.22, 0.35); hx = hy = r * wpm; }
    else if (rot) { cos = m00 / l0; sin = m01 / l0; bx = wx + m00 * cxM + m20 * czM; by = wy + m01 * cxM + m21 * czM; hx = l0 * hxM; hy = Math.abs(m21 * cos - m20 * sin) * hzM;
      if (kind === 'fence') { hx = Math.max(hx, 0.14 * wpm); hy = Math.max(hy, 0.14 * wpm); } }
    else { hx = Math.max(hxM * wpm, 0.14 * wpm); hy = Math.max(hzM * wpm, 0.14 * wpm); }
    const h = hv > 0.5 ? hv : Math.max(0.5, hM * vert); got += push(out, bx, by, hx, hy, cos, sin, h, kind, sub, cx, cy, rW); }
  return got; }
function scanObj(obj, ctx) {
  if (!obj || typeof obj !== 'object') return;
  const M = obj.renderModelMatrix || obj.modelMatrix || (obj.modelMatrices && typeof obj.modelMatrices.values === 'function' ? obj.modelMatrices.values().next().value : null);
  const list = Array.isArray(obj.children) ? obj.children : [];
  for (let i = -1; i < list.length; i++) {
    const c = i < 0 ? obj : list[i]; if (!c || typeof c !== 'object') continue;
    const ls = c.layerSettings || obj.layerSettings || {}, prog = ls.programName || '', A = c.vao && c.vao._attributes;
    const mChild = c.renderModelMatrix || M, sink = c.sink || ls.sink || '', sym = c.symbol || ls.symbol || '', sub = subOf(c, ctx.idx);
    if (WALL_PROG.test(prog) && A && A.a_vec2_vertex) {
      if (sink === 'topFill' && BUILD_RE.test(sub)) { ctx.stats.meshCount += fromRoof(c, mChild, sub, ctx.boxes, ctx.cx, ctx.cy, ctx.rW, ctx.wpm, ctx.gl); continue; }
      if ((sink === 'sideFill' || (sym === 'polygonExtrusion' && sink !== 'topFill')) && BUILD_RE.test(sub)) {
        const w = fromWalls(c, mChild, sub === '?' ? 'Building_wall' : sub, ctx.boxes, ctx.cx, ctx.cy, ctx.rW, ctx.wpm, ctx.gl);
        ctx.stats.meshCount += w; if (!w && c.bboxWorld) ctx.stats.meshCount += fromMesh(c, ctx.idx, ctx.boxes, ctx.cx, ctx.cy, ctx.rW, ctx.wpm); continue; }
    }
    if (ROAD_PROG.test(prog) && A && A.a_vec2_vertex && ROAD_RE.test(sub)) { ctx.stats.meshCount += fromRoad(c, mChild, sub, ctx.boxes, ctx.cx, ctx.cy, ctx.rW, ctx.wpm, ctx.gl); continue; }
    if (prog === 'vtxColor' && A && (A.a_vec3_vertex || A.a_vec2_vertex) && /^water/i.test(sub)) { ctx.stats.meshCount += fromWater(c, mChild, sub, ctx.boxes, ctx.cx, ctx.cy, ctx.rW, ctx.wpm, ctx.gl); continue; }
    const gltf = (c.instanceCount | 0) > 0 && (prog === 'gltfModel' || /gltf/i.test(prog) || (A && A.a_vec3_instance_position));
    if (gltf) ctx.stats.gltfCount += fromGltf(c, mChild, ctx.idx, ctx.boxes, ctx.cx, ctx.cy, ctx.rW, ctx.wpm, ctx.gl);
    else if (c.bboxWorld) ctx.stats.meshCount += fromMesh(c, ctx.idx, ctx.boxes, ctx.cx, ctx.cy, ctx.rW, ctx.wpm); } }
function tileAabb(M) {
  if (!M || !finite(M[0], M[5], M[12], M[13])) return null;
  const x0 = M[12], x1 = M[12] + M[0], y0 = M[13], y1 = M[13] + M[5];
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}
function aabbNear(aabb, cx, cy, rW) {
  const clX = clamp(cx, aabb[0], aabb[2]), clY = clamp(cy, aabb[1], aabb[3]);
  const dx = cx - clX, dy = cy - clY;
  return dx * dx + dy * dy <= rW * rW;
}
function extractNear(map, centerLng, centerLat, radiusM = 140) {
  const [cx, cy] = lngLatToWorld(centerLng, centerLat), wpm = wpmAtLat(centerLat), rW = radiusM * wpm;
  const inR = (b) => Math.hypot(b.wx - cx, b.wy - cy) <= rW + (b.hx || 0) + (b.hy || 0);
  const boxes = [], stats = { gltfCount: 0, meshCount: 0, tilesScanned: 0, total: 0 };
  readUsed = 0; budgetHit = false;
  try {
    const md = map && map._impl && map._impl.core && map._impl.core.modules, idx = subIndex(map);
    const tls = (md && md.tileManager && md.tileManager.tileLayers) || [];
    let gl = null; try { gl = typeof map.getWebGLContext === 'function' ? map.getWebGLContext() : null; } catch (_) {}
    for (const tl of tls) {
      const tiles = tl && tl.gridState && tl.gridState.tiles; if (!tiles) continue;
      for (const k of Object.keys(tiles)) {
        const mod = tiles[k] && tiles[k].currentMod, objs = mod && mod.objects;
        if (!Array.isArray(objs) || !objs.length) continue;
        let aabb = null;
        for (let oi = 0; oi < objs.length; oi++) {
          const aa = tileAabb(objs[oi] && (objs[oi].renderModelMatrix || objs[oi].modelMatrix));
          if (aa) { if (!aabb) aabb = aa; else { if (aa[0] < aabb[0]) aabb[0] = aa[0]; if (aa[1] < aabb[1]) aabb[1] = aa[1]; if (aa[2] > aabb[2]) aabb[2] = aa[2]; if (aa[3] > aabb[3]) aabb[3] = aa[3]; } }
        }
        if (aabb && !aabbNear(aabb, cx, cy, rW)) continue;
        stats.tilesScanned++;
        const ckey = tl.id + ':' + k;
        let entry = tileCache.get(ckey);
        if (!entry || entry.mod !== mod) {
          budgetHit = false;
          const lctx = { boxes: [], stats: { gltfCount: 0, meshCount: 0 }, idx, gl, wpm, cx, cy, rW: Infinity };
          for (const o of objs) scanObj(o, lctx);
          if (budgetHit) continue;
          entry = { mod, boxes: lctx.boxes, gltf: lctx.stats.gltfCount, mesh: lctx.stats.meshCount };
          if (tileCache.size >= TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value);
          tileCache.set(ckey, entry);
        }
        stats.gltfCount += entry.gltf; stats.meshCount += entry.mesh;
        for (let i = 0; i < entry.boxes.length; i++) boxes.push(entry.boxes[i]);
      }
    }
    try { const ms = md && md.modelsScene, arr = Array.isArray(ms) ? ms : ms && (ms.objects || ms.models); if (Array.isArray(arr)) for (const o of arr) scanObj(o, { boxes, stats, idx, gl, wpm, cx, cy, rW }); } catch (_) {}
  } catch (err) { try { console.warn('[GTA2GIS] collision extract failed', err); } catch (_) {} }
  const out0 = boxes.filter(inR); let out = out0;
  if (out.length > 18000) { out.sort((a, b) => Math.hypot(a.wx - cx, a.wy - cy) - Math.hypot(b.wx - cx, b.wy - cy)); out = out.slice(0, 18000); }
  stats.total = out.length; return { boxes: out, stats }; }
GTA.collisionExtract = { lngLatToWorld, worldToLngLat, wpmAtLat, extractNear };
})(WIN, GTA);

// --- src/collision.js ---
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

// --- src/player-gl.js ---
(function (WIN, GTA) {
  'use strict';
  const LAYER_ID = 'gta2gis-player-3d', D2R = Math.PI / 180, RETRY_MS = 200;
  const VS = 'attribute vec3 a_pos;attribute vec3 a_nrm;uniform mat4 u_mvp;varying vec3 v_n;void main(){gl_Position=u_mvp*vec4(a_pos,1.0);v_n=a_nrm;}';
  const FS = 'precision mediump float;varying vec3 v_n;uniform vec3 u_color;void main(){float l=max(dot(normalize(v_n),normalize(vec3(0.4,0.5,0.8))),0.0);gl_FragColor=vec4(u_color*(0.55+0.45*l),1.0);}';
  const C = { leg: [0.07, 0.85, 1], jacket: [1, 0.18, 0.59], arm: [0.1, 0.89, 1], head: [0.063, 0.098, 0.169], visor: [0, 0.94, 1], shadow: [0.22, 0.02, 0.2] };
  const CUBE = (() => {
    const out = new Float32Array(216), Q = [[-1, -1], [1, -1], [1, 1], [-1, 1]], A = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
    let o = 0;
    for (const [a, b, c] of A) for (const s of [1, -1]) {
      const base = [0, 0, 0], u = [0, 0, 0], v = [0, 0, 0], n = [0, 0, 0];
      base[a] = 0.5 * s; u[b] = 0.5; v[c] = 0.5; n[a] = s;
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const q = Q[k];
        out[o++] = base[0] + u[0] * q[0] + v[0] * q[1]; out[o++] = base[1] + u[1] * q[0] + v[1] * q[1]; out[o++] = base[2] + u[2] * q[0] + v[2] * q[1];
        out[o++] = n[0]; out[o++] = n[1]; out[o++] = n[2];
      }
    }
    return out;
  })();
  let map = null, ps = null, added = false, hooked = false, glc = null, prog = null, vbo = null, vao = null, U = null, VP = null, WPM = 0, retryAt = 0;
  const model = new Float64Array(16), mvp = new Float64Array(16), mvp32 = new Float32Array(16);

  function mul(o, a, b) {
    for (let c = 0; c < 16; c += 4) { const b0 = b[c], b1 = b[c + 1], b2 = b[c + 2], b3 = b[c + 3];
      for (let r = 0; r < 4; r++) o[c + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3; }
  }

  function part(wx, wy, wz, h, px, py, pz, rx, ox, oy, oz, sx, sy, sz, col) {
    const ch = Math.cos(h), sh = Math.sin(h), cr = Math.cos(rx), sr = Math.sin(rx), k = WPM;
    model[0] = ch * sx * k; model[1] = sh * sx * k; model[2] = 0; model[3] = 0;
    model[4] = -sh * cr * sy * k; model[5] = ch * cr * sy * k; model[6] = sr * sy * k; model[7] = 0;
    model[8] = sh * sr * sz * k; model[9] = -ch * sr * sz * k; model[10] = cr * sz * k; model[11] = 0;
    model[12] = wx + (ch * px - sh * py + ch * ox - sh * cr * oy + sh * sr * oz) * k;
    model[13] = wy + (sh * px + ch * py + sh * ox + ch * cr * oy - ch * sr * oz) * k;
    model[14] = wz + (pz + sr * oy + cr * oz) * k; model[15] = 1;
    mul(mvp, VP, model); mvp32.set(mvp);
    glc.uniformMatrix4fv(U.mvp, false, mvp32);
    glc.uniform3f(U.color, col[0], col[1], col[2]);
    glc.drawArrays(glc.TRIANGLES, 0, 36);
  }

  function shader(type, src) {
    const s = glc.createShader(type); glc.shaderSource(s, src); glc.compileShader(s);
    if (!glc.getShaderParameter(s, glc.COMPILE_STATUS)) throw new Error(glc.getShaderInfoLog(s) || 'shader'); return s;
  }

  function setup(gl) {
    if (prog && glc === gl) return true;
    glc = gl; prog = vbo = vao = null;
    try {
      const p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
      prog = p; U = { mvp: gl.getUniformLocation(p, 'u_mvp'), color: gl.getUniformLocation(p, 'u_color'), pos: gl.getAttribLocation(p, 'a_pos'), nrm: gl.getAttribLocation(p, 'a_nrm') };
      vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, CUBE, gl.STATIC_DRAW);
      if (gl.createVertexArray) { vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.enableVertexAttribArray(U.pos); gl.vertexAttribPointer(U.pos, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(U.nrm); gl.vertexAttribPointer(U.nrm, 3, gl.FLOAT, false, 24, 12); gl.bindVertexArray(null); }
      return true;
    } catch (_) { prog = null; return false; }
  }

  function ensure() {
    if (!map || typeof map.addLayer !== 'function') return false;
    let has = added;
    try { if (typeof map.hasLayer === 'function') has = has || !!map.hasLayer(LAYER_ID); } catch (_) {}
    if (has) { added = true; return true; }
    added = false;
    let ok = true;
    try { const impl = map._impl, sm = impl && impl.core && impl.core.modules && impl.core.modules.styleManager, sid = impl && impl.state && impl.state.handyStyleId != null ? impl.state.handyStyleId : 1;
      ok = !sm || typeof sm.getStyle !== 'function' || !!sm.getStyle(sid); } catch (_) { ok = false; }
    if (!ok) return false;
    try { const r = map.addLayer({ id: LAYER_ID, type: 'custom', minzoom: 0, maxzoom: 24, render: draw }); added = true;
      if (r && typeof r.then === 'function') r.then(null, () => { added = false; }); } catch (_) { added = false; retryAt = Date.now() + 1000; }
    return added;
  }

  function draw(gl) {
    if (!ps || !ps.active || !map || !gl || (gl.isContextLost && gl.isContextLost())) return;
    const ex = GTA.collisionExtract; if (!ex || typeof ex.lngLatToWorld !== 'function') return;
    const lat = +ps.lat, p = ex.lngLatToWorld(+ps.lng, lat), wpm = typeof ex.wpmAtLat === 'function' ? ex.wpmAtLat(lat) : 0;
    if (!p || !isFinite(p[0]) || !isFinite(p[1]) || !(wpm > 0)) return;
    const cam = map._impl && map._impl.core && map._impl.core.modules && map._impl.core.modules.camera;
    VP = (cam && cam.viewProjectionMatrix) || (typeof map.getProjectionMatrix === 'function' ? map.getProjectionMatrix() : null);
    if (!VP || VP.length !== 16) return;
    const hasVao = !!gl.createVertexArray, na = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    const prev = { prog: gl.getParameter(gl.CURRENT_PROGRAM), ab: gl.getParameter(gl.ARRAY_BUFFER_BINDING), en: [],
      vao: hasVao ? gl.getParameter(gl.VERTEX_ARRAY_BINDING) : null, dt: gl.isEnabled(gl.DEPTH_TEST), dm: gl.getParameter(gl.DEPTH_WRITEMASK),
      df: gl.getParameter(gl.DEPTH_FUNC), cf: gl.isEnabled(gl.CULL_FACE), bl: gl.isEnabled(gl.BLEND), at: gl.getParameter(gl.ACTIVE_TEXTURE), tex: gl.getParameter(gl.TEXTURE_BINDING_2D) };
    try {
      for (let i = 0; i < na; i++) if (gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED)) prev.en.push(i);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      if (!setup(gl) || !U || U.pos < 0 || U.nrm < 0) return; gl.useProgram(prog);
      for (let i = 0; i < na; i++) gl.disableVertexAttribArray(i);
      if (vao) gl.bindVertexArray(vao); else { gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.enableVertexAttribArray(U.pos); gl.vertexAttribPointer(U.pos, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(U.nrm); gl.vertexAttribPointer(U.nrm, 3, gl.FLOAT, false, 24, 12); }
      const h = -(+ps.heading || 0) * D2R, wx = p[0], wy = p[1], wz = (+ps.z || 0) * wpm; WPM = wpm;
      const phase = +ps.walkPhase || 0, spd = Math.max(0, +ps.speed || 0);
      // Pose selector: swim/wall-run lay the body horizontal (roll about local X), jump tucks legs and lifts arms.
      const swim = !!ps.swimming, wall = !swim && !!ps.wallRunning, proto = !swim && !wall && !!ps.prototype;
      const air = !swim && !wall && ps.grounded != null && !ps.grounded;
      const roll = -Math.PI / 2, horiz = swim || wall, bob = swim ? Math.sin(phase * 0.7) * 0.07 : 0;
      let sw = Math.sin(phase) * (spd > 0.3 ? Math.min(1, spd / 9) * 0.6 : 0), lean = Math.min(0.09, spd * 0.01);
      if (proto) { sw = Math.sin(phase * 1.9) * (spd > 0.2 ? Math.min(1, spd / 6) * 0.95 : 0.4); lean = Math.min(0.26, 0.13 + spd * 0.022); }
      if (air) sw = 0;
      if (horiz) sw = Math.sin(phase) * (swim ? 0.9 : Math.max(0.6, Math.min(1, spd / 9) * 0.6));
      const legPx = proto ? 0.19 : 0.17, legPz = horiz ? 0.5 + bob : 0.78;
      const legOz = horiz ? -0.55 : air ? -0.24 : -0.39, legSz = air ? 0.52 : 0.78;
      const legRxL = horiz ? roll + sw * (swim ? 0.5 : 0.9) : air ? 0.55 : sw;
      const legRxR = horiz ? roll - sw * (swim ? 0.5 : 0.9) : air ? 0.3 : -sw;
      part(wx, wy, (+ps.floorZ || 0) * wpm, h, 0, 0, 0, 0, 0, 0, 0.012, 0.9, 0.9, 0.012, C.shadow);
      part(wx, wy, wz, h, -legPx, 0, legPz, legRxL, 0, 0, legOz, 0.21, 0.26, legSz, C.leg);
      part(wx, wy, wz, h, legPx, 0, legPz, legRxR, 0, 0, legOz, 0.21, 0.26, legSz, C.leg);
      const bodyRx = horiz ? roll : -lean;
      part(wx, wy, wz, h, 0, 0, horiz ? 0.5 + bob : 0.78, bodyRx, 0, 0, horiz ? 0.2 : 0.34, 0.62, 0.36, 0.68, C.jacket);
      const armPx = wall ? 0.6 : swim ? 0.42 : air ? 0.44 : proto ? 0.46 : 0.37;
      const armPz = horiz ? 0.52 + bob : air ? 1.45 : 1.36;
      let aSx = 0.15, aSy = 0.18, aSz = 0.56;
      let aLoz = horiz ? 0.2 : air ? 0.16 : proto ? -0.24 : -0.28, aRoz = aLoz, aLrx, aRrx;
      if (wall) { aSx = 0.55; aSy = 0.16; aSz = 0.18; aLrx = 0; aRrx = 0; }
      else if (swim) { aSx = 0.14; aSy = 0.16; aSz = 0.5; aLrx = roll + Math.cos(phase) * 0.35; aRrx = roll - Math.cos(phase) * 0.35; aLoz = 0.2 + Math.sin(phase) * 0.25; aRoz = 0.2 - Math.sin(phase) * 0.25; }
      else if (air) { aLrx = -0.45; aRrx = -0.45; }
      else if (proto) { aLrx = -sw; aRrx = sw; }
      else { aLrx = -sw * 0.8; aRrx = sw * 0.8; }
      part(wx, wy, wz, h, -armPx, 0, armPz, aLrx, 0, 0, aLoz, aSx, aSy, aSz, C.arm);
      part(wx, wy, wz, h, armPx, 0, armPz, aRrx, 0, 0, aRoz, aSx, aSy, aSz, C.arm);
      part(wx, wy, wz, h, 0, 0, horiz ? 0.52 + bob : 0.78, bodyRx, 0, 0, horiz ? 0.78 : 0.83, 0.42, 0.4, 0.38, C.head);
      part(wx, wy, wz, h, 0, 0, horiz ? 0.52 + bob : 0.78, bodyRx, 0, horiz ? 0 : 0.21, horiz ? 0.98 : 0.84, 0.34, horiz ? 0.1 : 0.05, horiz ? 0.1 : 0.1, C.visor);
    } catch (_) {} finally {
      try {
        gl.useProgram(prev.prog); if (hasVao) gl.bindVertexArray(prev.vao); gl.bindBuffer(gl.ARRAY_BUFFER, prev.ab);
        for (let i = 0; i < na; i++) { if (prev.en.indexOf(i) >= 0) gl.enableVertexAttribArray(i); else gl.disableVertexAttribArray(i); }
        gl.depthMask(prev.dm); gl.depthFunc(prev.df); if (prev.dt) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        if (prev.cf) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE); if (prev.bl) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
        gl.activeTexture(prev.at); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
        const r = map && map._impl && map._impl.core && map._impl.core.modules && map._impl.core.modules.renderer;
        if (r && typeof r.resetStateAfterExternalRender === 'function') r.resetStateAfterExternalRender();
      } catch (_) {}
    }
  }

  function attach(m, s) {
    if (!m) return api;
    if (m !== map) { map = m; added = false; hooked = false; retryAt = 0; }
    if (s) ps = s;
    if (!added && !hooked && typeof map.on === 'function') { hooked = true;
      try { if (typeof map.once === 'function') map.once('styleload', () => ensure()); else map.on('styleload', () => ensure()); } catch (_) { hooked = false; } }
    ensure(); return api;
  }

  function setState(s) {
    if (s) ps = s;
    if (!added && Date.now() >= retryAt) { retryAt = Date.now() + RETRY_MS; ensure(); }
    return api;
  }

  function detach(m) {
    const M = m || map;
    try { if (M && typeof M.removeLayer === 'function') M.removeLayer(LAYER_ID); } catch (_) {}
    try { if (glc) { if (prog) glc.deleteProgram(prog); if (vbo) glc.deleteBuffer(vbo); if (vao) glc.deleteVertexArray(vao); } } catch (_) {}
    map = null; ps = null; added = false; hooked = false; glc = prog = vbo = vao = null; U = null; retryAt = 0; return api;
  }

  const api = { attach: attach, detach: detach, setState: setState };
  GTA.playerGL = api;
})(WIN, GTA);

// --- src/vehicle.js ---
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

// --- src/vehicle-gl.js ---
(function (WIN, GTA) {
  'use strict';
  const LAYER_ID = 'gta2gis-vehicle-3d', D2R = Math.PI / 180, RETRY_MS = 200;
  const VS = 'attribute vec3 a_pos;attribute vec3 a_nrm;uniform mat4 u_mvp;varying vec3 v_n;void main(){gl_Position=u_mvp*vec4(a_pos,1.0);v_n=a_nrm;}';
  const FS = 'precision mediump float;varying vec3 v_n;uniform vec3 u_color;void main(){float l=max(dot(normalize(v_n),normalize(vec3(0.4,0.5,0.8))),0.0);gl_FragColor=vec4(u_color*(0.55+0.45*l),1.0);}';
  const C = { body: [1, 0.18, 0.59], glass: [0.047, 0.169, 0.2], neon: [0, 0.94, 1], tire: [0.039, 0.059, 0.102],
    light: [0.75, 1, 1], tail: [1, 0.06, 0.42], trim: [0.03, 0.05, 0.09], shadow: [0.02, 0.02, 0.05] };
  const CUBE = (() => {
    const out = new Float32Array(216), Q = [[-1, -1], [1, -1], [1, 1], [-1, 1]], A = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
    let o = 0;
    for (const [a, b, c] of A) for (const s of [1, -1]) {
      const B = [0, 0, 0], Uv = [0, 0, 0], Vv = [0, 0, 0], N = [0, 0, 0];
      B[a] = 0.5 * s; Uv[b] = 0.5; Vv[c] = 0.5; N[a] = s;
      for (const k of [0, 1, 2, 0, 2, 3]) { const q = Q[k];
        out[o++] = B[0] + Uv[0] * q[0] + Vv[0] * q[1]; out[o++] = B[1] + Uv[1] * q[0] + Vv[1] * q[1]; out[o++] = B[2] + Uv[2] * q[0] + Vv[2] * q[1];
        out[o++] = N[0]; out[o++] = N[1]; out[o++] = N[2]; }
    }
    return out;
  })();
  let map = null, vs = null, added = false, hooked = false, glc = null, prog = null, vbo = null, vao = null, U = null, VP = null, WPM = 0, retryAt = 0;
  const model = new Float64Array(16), mvp = new Float64Array(16), mvp32 = new Float32Array(16);

  function mul(o, a, b) {
    for (let c = 0; c < 16; c += 4) { const b0 = b[c], b1 = b[c + 1], b2 = b[c + 2], b3 = b[c + 3];
      for (let r = 0; r < 4; r++) o[c + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3; }
  }

  function part(wx, wy, wz, h, px, py, pz, rx, ox, oy, oz, sx, sy, sz, col) {
    const ch = Math.cos(h), sh = Math.sin(h), cr = Math.cos(rx), sr = Math.sin(rx), k = WPM;
    model[0] = ch * sx * k; model[1] = sh * sx * k; model[2] = 0; model[3] = 0;
    model[4] = -sh * cr * sy * k; model[5] = ch * cr * sy * k; model[6] = sr * sy * k; model[7] = 0;
    model[8] = sh * sr * sz * k; model[9] = -ch * sr * sz * k; model[10] = cr * sz * k; model[11] = 0;
    model[12] = wx + (ch * px - sh * py + ch * ox - sh * cr * oy + sh * sr * oz) * k;
    model[13] = wy + (sh * px + ch * py + sh * ox + ch * cr * oy - ch * sr * oz) * k;
    model[14] = wz + (pz + sr * oy + cr * oz) * k; model[15] = 1;
    mul(mvp, VP, model); mvp32.set(mvp);
    glc.uniformMatrix4fv(U.mvp, false, mvp32); glc.uniform3f(U.color, col[0], col[1], col[2]);
    glc.drawArrays(glc.TRIANGLES, 0, 36);
  }
  function shader(type, src) {
    const s = glc.createShader(type); glc.shaderSource(s, src); glc.compileShader(s);
    if (!glc.getShaderParameter(s, glc.COMPILE_STATUS)) throw new Error(glc.getShaderInfoLog(s) || 'shader'); return s;
  }
  function setup(gl) {
    if (prog && glc === gl) return true;
    glc = gl; prog = vbo = vao = null;
    try {
      const p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, VS)); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
      prog = p; U = { mvp: gl.getUniformLocation(p, 'u_mvp'), color: gl.getUniformLocation(p, 'u_color'), pos: gl.getAttribLocation(p, 'a_pos'), nrm: gl.getAttribLocation(p, 'a_nrm') };
      vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo); gl.bufferData(gl.ARRAY_BUFFER, CUBE, gl.STATIC_DRAW);
      if (gl.createVertexArray) { vao = gl.createVertexArray(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.enableVertexAttribArray(U.pos); gl.vertexAttribPointer(U.pos, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(U.nrm); gl.vertexAttribPointer(U.nrm, 3, gl.FLOAT, false, 24, 12); gl.bindVertexArray(null); }
      return true;
    } catch (_) { prog = null; return false; }
  }
  function ensure() {
    if (!map || typeof map.addLayer !== 'function') return false;
    let has = added;
    try { if (typeof map.hasLayer === 'function') has = has || !!map.hasLayer(LAYER_ID); } catch (_) {}
    if (has) { added = true; return true; }
    added = false;
    let ok = true;
    try { const impl = map._impl, sm = impl && impl.core && impl.core.modules && impl.core.modules.styleManager, sid = impl && impl.state && impl.state.handyStyleId != null ? impl.state.handyStyleId : 1;
      ok = !sm || typeof sm.getStyle !== 'function' || !!sm.getStyle(sid); } catch (_) { ok = false; }
    if (!ok) return false;
    try { const r = map.addLayer({ id: LAYER_ID, type: 'custom', minzoom: 0, maxzoom: 24, render: draw }); added = true;
      if (r && typeof r.then === 'function') r.then(null, () => { added = false; }); } catch (_) { added = false; retryAt = Date.now() + 1000; }
    return added;
  }
  function draw(gl) {
    const s = (GTA.vehicle && GTA.vehicle.state) || vs;
    if (!s || !s.active || !map || !gl || (gl.isContextLost && gl.isContextLost())) return;
    const ex = GTA.collisionExtract; if (!ex || typeof ex.lngLatToWorld !== 'function') return;
    const lat = +s.lat, p = ex.lngLatToWorld(+s.lng, lat), wpm = typeof ex.wpmAtLat === 'function' ? ex.wpmAtLat(lat) : 0;
    if (!p || !isFinite(p[0]) || !isFinite(p[1]) || !(wpm > 0)) return;
    const cam = map._impl && map._impl.core && map._impl.core.modules && map._impl.core.modules.camera;
    VP = (cam && cam.viewProjectionMatrix) || (typeof map.getProjectionMatrix === 'function' ? map.getProjectionMatrix() : null);
    if (!VP || VP.length !== 16) return;
    const hasVao = !!gl.createVertexArray, na = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
    const prev = { prog: gl.getParameter(gl.CURRENT_PROGRAM), ab: gl.getParameter(gl.ARRAY_BUFFER_BINDING), en: [],
      vao: hasVao ? gl.getParameter(gl.VERTEX_ARRAY_BINDING) : null, dt: gl.isEnabled(gl.DEPTH_TEST), dm: gl.getParameter(gl.DEPTH_WRITEMASK),
      df: gl.getParameter(gl.DEPTH_FUNC), cf: gl.isEnabled(gl.CULL_FACE), bl: gl.isEnabled(gl.BLEND), at: gl.getParameter(gl.ACTIVE_TEXTURE), tex: gl.getParameter(gl.TEXTURE_BINDING_2D) };
    try {
      for (let i = 0; i < na; i++) if (gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED)) prev.en.push(i);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      if (!setup(gl) || !U || U.pos < 0 || U.nrm < 0) return; gl.useProgram(prog);
      for (let i = 0; i < na; i++) gl.disableVertexAttribArray(i);
      if (vao) gl.bindVertexArray(vao); else { gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.enableVertexAttribArray(U.pos); gl.vertexAttribPointer(U.pos, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(U.nrm); gl.vertexAttribPointer(U.nrm, 3, gl.FLOAT, false, 24, 12); }
      const h = (+s.heading || 0) * D2R, wx = p[0], wy = p[1], wz = (+s.z || 0) * wpm;
      WPM = wpm;
      const spin = +s.wheelPhase || 0, lean = Math.max(-0.07, Math.min(0.07, +s.lean || 0));
      part(wx, wy, wz, h, 0, 0, 0.006, 0, 0, 0, 0, 2.35, 4.9, 0.012, C.shadow);
      part(wx, wy, wz, h, 0, 0, 0.575, lean, 0, 0, 0, 1.9, 4.4, 0.55, C.body); // bottom sits at z=0.30
      part(wx, wy, wz, h, 0, -0.35, 0.95, lean, 0, 0, 0, 1.6, 2.0, 0.55, C.glass);
      part(wx, wy, wz, h, 0, 0.66, 1.0, 0.38 + lean, 0, 0, 0, 1.44, 0.12, 0.44, C.neon);
      part(wx, wy, wz, h, 0, -1.36, 0.98, -0.38 + lean, 0, 0, 0, 1.34, 0.1, 0.4, C.neon);
      for (const u of [-1, 1]) {
        part(wx, wy, wz, h, u * 0.96, 0, 0.36, lean, 0, 0, 0, 0.05, 3.3, 0.06, C.neon);
        part(wx, wy, wz, h, u * 0.72, -1.95, 0.93, lean, 0, 0, 0, 0.08, 0.14, 0.26, C.trim);
        part(wx, wy, wz, h, u * 0.64, 2.18, 0.72, lean, 0, 0, 0, 0.42, 0.12, 0.18, C.light);
        part(wx, wy, wz, h, u * 0.62, -2.18, 0.75, lean, 0, 0, 0, 0.46, 0.1, 0.17, C.tail);
        part(wx, wy, wz, h, u * 0.95, 1.6, 0.45, spin, 0, 0, 0, 0.36, 0.9, 0.9, C.neon);
        part(wx, wy, wz, h, u * 0.95, 1.6, 0.45, spin, 0, 0, 0, 0.44, 0.7, 0.7, C.tire);
        part(wx, wy, wz, h, u * 0.95, -1.6, 0.45, spin, 0, 0, 0, 0.36, 0.9, 0.9, C.neon);
        part(wx, wy, wz, h, u * 0.95, -1.6, 0.45, spin, 0, 0, 0, 0.44, 0.7, 0.7, C.tire);
      }
      part(wx, wy, wz, h, 0, -1.95, 1.05, lean, 0, 0, 0, 1.72, 0.34, 0.09, C.trim);
    } catch (_) {} finally {
      try {
        gl.useProgram(prev.prog); if (hasVao) gl.bindVertexArray(prev.vao); gl.bindBuffer(gl.ARRAY_BUFFER, prev.ab);
        for (let i = 0; i < na; i++) { if (prev.en.indexOf(i) >= 0) gl.enableVertexAttribArray(i); else gl.disableVertexAttribArray(i); }
        gl.depthMask(prev.dm); gl.depthFunc(prev.df); if (prev.dt) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
        if (prev.cf) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE); if (prev.bl) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
        gl.activeTexture(prev.at); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
        const r = map && map._impl && map._impl.core && map._impl.core.modules && map._impl.core.modules.renderer;
        if (r && typeof r.resetStateAfterExternalRender === 'function') r.resetStateAfterExternalRender();
      } catch (_) {}
    }
  }
  function attach(m, s) {
    if (!m) return api;
    if (m !== map) { map = m; added = false; hooked = false; retryAt = 0; }
    if (s) vs = s;
    if (!added && !hooked && typeof map.on === 'function') { hooked = true;
      try { if (typeof map.once === 'function') map.once('styleload', () => ensure()); else map.on('styleload', () => ensure()); } catch (_) { hooked = false; } }
    ensure(); return api;
  }
  function setState(s) {
    if (s) vs = s;
    if (!added && Date.now() >= retryAt) { retryAt = Date.now() + RETRY_MS; ensure(); }
    return api;
  }
  function detach(m) {
    const M = m || map;
    try { if (M && typeof M.removeLayer === 'function') M.removeLayer(LAYER_ID); } catch (_) {}
    try { if (glc) { if (prog) glc.deleteProgram(prog); if (vbo) glc.deleteBuffer(vbo); if (vao) glc.deleteVertexArray(vao); } } catch (_) {}
    map = null; vs = null; added = false; hooked = false; glc = prog = vbo = vao = null; U = null; retryAt = 0; return api;
  }
  const api = { attach: attach, detach: detach, setState: setState };
  GTA.vehicleGL = api;
})(WIN, GTA);

// --- src/overlay.js ---
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

// --- src/camera-player.js ---
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

// --- src/hud.js ---
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

// --- src/main.js ---
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
})();
