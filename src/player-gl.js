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
