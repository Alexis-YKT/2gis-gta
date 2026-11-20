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
