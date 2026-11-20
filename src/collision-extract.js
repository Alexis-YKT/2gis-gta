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
