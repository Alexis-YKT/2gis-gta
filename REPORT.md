# 2GIS (mapgl) runtime internals — research report for a Tampermonkey driving/walking game

Target: `https://2gis.ru/yakutsk/geo/70030076156701276/129.7535%2C62.030792?m=129.736714%2C62.023857%2F20%2Fp%2F50%2Fr%2F-130`
Page title: `Северное сияние / 203-й микрорайон, 35/1 на карте Якутска — 2ГИС`
All findings below were produced by live `page.evaluate` calls in Chromium (WebGL2, DPR 2).

---

## 1. Finding the MapGL instance from a userscript

### 1.1 What actually exists on `window`

```
Object.keys(window).filter(k => /map|gl|store|state|init|dg|2gis|redux|react/i.test(k))
=> ["onbeforetoggle","oncontentvisibilityautostatechange","oncontextrestored","ondragleave",
    "ontoggle","onpopstate","createImageBitmap","cookieStore","initialState",
    "__REACT_QUERY_STATE__","initErrorsStack","tnsCounter2gis_ru","global","GOOGLE_CLICK_ID",
    "getGoogleClickIdParameters","validateAndMappedParams","_assertThisInitialized",
    "_mapgl_d","__mapglPlugins","mapgl"]
```

There is **no** `__store`, `__INITIAL_STATE__`, `DG`, `dg`, `store`, `mapInstance`, `__2gis`.
`window.map` **is not the map** — it is `HTMLDivElement#map` (own props only `__reactFiber$…`, `__reactProps$…`).

### 1.2 `window.mapgl` is the real `Map` instance

```
window.mapgl
  ctor: (own-props) "events","_impl","_controlPane","_defaultSource",
                    "HtmlMarker","Polyline","Ruler","RulerControl"
  proto (real API):
    setCenter getCenter setZoom getZoom getStyleZoom setStyleZoom setRotation getRotation
    setPitch getPitch setMinZoom getMinZoom setMaxZoom setMaxZoom setMinPitch setMaxPitch
    getSize isIdle getBounds project unproject getProjectionMatrix getWebGLContext getCanvas
    getContainer invalidateSize showTraffic hideTraffic setSelectedObjects setStyleById
    setLanguage setFloorPlanLevel setMaxBounds getPadding getDefaultSource setPadding
    hasLayer addLayer addDraftLayer addIcon removeIcon addModel removeLayer fitBounds
    setStyleState getStyleState patchStyleState setStyleOptions setOption getOption
    triggerRerender setHiddenObjects getGroundPoint getElevationAtTier hideLayers showLayers
    blockInteraction destroy ...
```

Descriptor (important for hooking):
```
Object.getOwnPropertyDescriptor(window, 'mapgl')
=> { writable: true, configurable: true, enumerable: true, get: false, set: false }
```

`window.mapgl._impl` is the engine (`Vg`):
```
_impl own: events, styleRequestGeneration, destroyed, core, state, modules,
           performanceChecker, values, stylePreparationController,
           currentPendingStyle, _bssDispatcher
core.modules: benchmark profiler map camera layout collector workers identifier
              styleManager assetManager imageManager uiPoiSource floorManager
              personalPoiManager buildingHeightAnimator modelsScene renderer sunda
              layers sourceStorage tileManager modelLayer dynamicStyle imageCache
              labeler trafficTileLayer handler mouseMoveHandler tileKeyInfo
              elevationIndex demManager environmentManager defaultSource labelsDebug
              postEffectsManager renderCacheManager animationManager shadowManager
              particleManager instanceLinker performanceChecker scheduler
```

### 1.3 React fiber does NOT hold the map

`#map` has `__reactFiber$<hash>`; walking 30 fibers up (`div → div → mapWrapper →
WithStyles(mapWrapper) → MapContainer → WithBss(MapContainer) → …`) and scanning
`memoizedProps`, `memoizedState` hook chains (`hook.current`, `hook.current.map`) and
`stateNode` found **no** object with `getCenter`/`setPitch`. Do not rely on React.

### 1.4 Canvas / context hooks are unnecessary

```
HTMLCanvasElement.prototype.getContext.toString() => "function getContext() { [native code] }"
webgl2 context attrs: { alpha: true, antialias: false, depth: true, stencil: false,
                        preserveDrawingBuffer: false, premultipliedAlpha: true }
mapgl.getWebGLContext() === mapgl._impl.core.modules.renderer._gl  => true   // shared context
```

Canvases on the page (2):
| # | size | rect | notes |
|---|------|------|-------|
| 0 | 1295×818 (attr) / 1036×655 CSS | 0,0 | main map canvas, `display:block` |
| 1 | same | 0,0 | `position:absolute; left:0; top:0; pointer-events:none; display:none` — identify/pick buffer |

### 1.5 Verified capture strategy (and a verified trap)

`window.mapgl` is assigned by the app bundle, *after* `DOMContentLoaded`. Plain polling works:

```js
// @run-at document-idle
const waitMap = () => new Promise(res => {
  const t = setInterval(() => {
    const m = window.mapgl && window.mapgl._impl && window.mapgl._impl.core
      ? window.mapgl : null;
    if (m && typeof m.project === 'function') { clearInterval(t); res(m); }
  }, 100);
});
```

**Do not** shadow the global at `document-start`. Tested with
`Object.defineProperty(window,'mapgl',{get,set})` injected via `addInitScript` + reload:

```
[ERROR] TypeError: Cannot set properties of undefined (setting 'Ruler')
        at Module.<anonymous> (https://d-assets.2gis.ru/rarity-3d.<hash>.js:1:28907)
[ERROR] ReferenceError: Cannot access 'y' before initialization
        at Module.get3dMap (https://d-assets.2gis.ru/map3d.<hash>.js:1:245)
[ERROR] ReferenceError: Cannot access 'h' before initialization
        at Module.update (https://d-assets.2gis.ru/map3d.<hash>.js:1:283)
=> window.mapgl === undefined forever; map never created
```

The accessor intercepts a module-scope read and breaks the bundle's init order
(TDZ). A clean reload without the hook restores `window.mapgl` normally. Use polling,
or at most wrap in `try/catch` and re-read the plain property (never define a getter).

---

## 2. Camera & projection API

```js
mapgl.setCenter(lngLat, opts)   // setCenter(e,t){return this._impl.setCenter(e,t),this}
mapgl.setZoom(z, opts)          // (e,t) => this
mapgl.setStyleZoom(z, opts)
mapgl.setRotation(deg, opts)
mapgl.setPitch(deg, opts)
mapgl.getProjectionMatrix()     // () => _impl.getCameraViewProjectionMatrix().slice()
mapgl.getBounds()               // { northEast:[lng,lat], southWest:[lng,lat] }
mapgl.getSize()                 // [viewportW, viewportH]  (NOT canvas size)
```

### 2.1 Instant updates — verified

All four setters apply **synchronously** with `{duration: 0}`:

```
before: center [129.736714, 62.023857] zoom 20 rot -130 pitch 50
setCenter([129.74,62.025], {duration:0})  -> getCenter() [129.74, 62.025]  (0.8 ms for 4 calls)
setRotation(-100, {duration:0})           -> getRotation() -100
setPitch(45, {duration:0})                -> getPitch() 45
setZoom(18, {duration:0})                 -> getZoom() 18
restore all four with {duration:0}        -> exact original values restored
```

`setCenter([lng,lat], false)` did **not** move the camera (boolean is not a recognized
flag) → always use `{ duration: 0 }`.

The pointer stays valid across zoom changes: call `setCenter`/`setZoom` inside
`requestAnimationFrame` and read back with the getters — no easing, no async.

Camera internals (`_impl.core.modules.camera`, ctor `ti`):
```
own: state, position, projectionMatrix, viewMatrix, viewMatrixTranspose,
     projectionMatrixInverse, viewProjectionMatrix, viewProjectionMatrixInverse,
     globeMatrix, ecefMvpMatrix, globeRatio, fogDistance, correctedPitch,
     correctedRotation, horizonPixelOffset, prevZoom, prevTime, flat, ecef
methods: setState update project unproject getViewportVertices limitPitchRotation
         updateProjectionMatrices updateNearFarState updateViewMatrix updateGlobeMatrix
```
`mapgl.getProjectionMatrix()` returned (zoom 20 / pitch 50 / rot −130):
`[-1.7957, 1.3021, 0.5868, 0.5868, -2.1400, -1.0926, -0.4924, -0.4924, 0, 2.0257,
 -0.6428, -0.6428, 4.8126e9, -9.7737e8, -4.4047e8, -4.4047e8]` — i.e. the matrix
operates in the engine's 2^32 world space (see §3.5), not in metres.

### 2.2 `project` / `unproject` coordinate space — verified

```
mapgl.getSize()            => [620, 655]      // map viewport (right of the panel)
mapgl.getCanvas()          => canvas 1036×655 CSS px
_impl.state.viewport       => { top:0, right:0, bottom:0, left:416 }
mapgl.project(center)      => [726.0, 327.5]  // = 310 + 416 → canvas-space CSS px
mapgl.unproject([726,327.5]) => [129.73671400000146, 62.023856999999964]
```
So `project()` already includes `viewport.left`; its output maps 1:1 onto the map
canvas (which starts at 0,0), **not** onto `getSize()`.

### 2.3 Terrain / ground

```
mapgl.getGroundPoint(screenPoint) => _impl.modules.demManager.getGroundPoint(...)   // undefined: DEM off
mapgl.getElevationAtTier(lngLat, tier, ?) =>
  { relativeZ: r.relativeZ/scaleFactor, absoluteZ: ..., surface: ... }   // metres ÷ Mercator.scaleFactor
```

---

## 3. Collision geometry extraction

### 3.1 Tile-layer registry (the entry point)

```
mapgl._impl.core.modules.tileManager
  own: state, modules, tileLayers[4], objects[17], viewportDiffer, metroDiffer

tileLayers[*].gridState.tiles = plain object, key `${x}_${y}_${z}_${detail}`
tileLayers[*].gridState.tileModsCache   // LRU {size,onRemove,map,_length,head,tail}
```

| tileLayer id | grid type | source | what it holds |
|---|---|---|---|
| 2 | zenith | `ts=vector_a` `dt=static,immersive_roads` | low-zoom world (8/8) |
| 3 | zenith | same | **all 2D vector geometry** at detail 17 |
| 4 | geojson | `/v2/ald?ts=com_poi_web` | POI points (`db_label`, `db_poi_category`, `db_id` …) |
| 5 | geojson | `/v2/ald?ts=vector_immersive` | **GLB building anchors** (`building_id`, `model_src`, `scale`, `angle`) |

Tile record → `currentMod`:

```js
const tl  = mapgl._impl.core.modules.tileManager.tileLayers.find(t => t.id === 3);
const rec = tl.gridState.tiles['28192_23632_15_17'];
rec.currentMod = {
  key, labelsKey, useful, ready, needGenerate, tile, status, params,
  generatedData: [ { regionId, styleHash, metatileHash, styleId, collectorOutput } ],
  objects: [ <Ep tile mesh>, ... ]
}
```

`rec.currentMod.params` (verified):
```json
{"selectedIds":["70030076156701276"],
 "styleState":{"trafficOn":false,"parkingOn":false,"navigatorOn":false,
   "immersiveRoadsOn":true,"floorStackOn":true,"terrainEnabled":false,"lang":"en",
   "graphicsPreset":"immersive","globeEnabled":true,"premiumSelected":false},
 "tileRevision":0,"styleRevision":0,"styleId":1,"globeMode":false}
```

### 3.2 Decoded source geometry is NOT kept as GeoJSON

`collectorOutput` keys:
```
data, labels, floorHidingMap, packedRasters (Uint16Array), rastersToLoad (Float64Array),
dataModelsUrls, identifyIds, transferable, promotedObjectAttributes, debugGeoJsonData
```
`demoGeoJsonData === undefined` (debug off) and `data[].buffer` is **already packed GPU
vertex data**, not lng/lat. Do not try to read GeoJSON from here.

`co.data[]` shape (verified):
```js
{
  symbol: 'polygon' | 'line' | 'metricPoint',
  sink:   'fill' | 'stroke' | 'solid' | 'patterned',
  buffer: ArrayBuffer,                 // interleaved vertex data, uploaded verbatim
  generatedObjects: [{
    attributes: [styleId, layerId, ...layerSpecific],   // e.g. [1, 309, undefined, "", ""]
    drawMode: 4,                       // gl.TRIANGLES
    rangeStart, rangeEnd,              // byte range inside buffer
    objectsData: { "<buildingId>": [ {offset, size}, ... ] },
    extents: Float32Array(6), maxDiag
  }]
}
```
`co.identifyIds` (per-vertex object ids — lets you map vertex ranges → building ids):
```
{ idBuffer, orphanIds, floorIdBuffer, startIndex, endIndex, phaseBuffer,
  sublayerBuffer, styleIdBuffer, layerIdBuffer, instanceIdBuffer,
  objectClassBuffer, centerBuffer, strings }
```

### 3.3 Why the packed fill/line buffers are a dead end

Each mesh child is:
```js
{ id, type:0, layerSettings:{programName}, count, start, drawMode:4,
  attributes:{ styleId, layerId, tiers, floorId, hiddenByFloorComplexId, tileData },
  vao, bbox, bboxWorld, instanceCount, meta }
```
`vao._attributes` for a `vtxColor` road bucket:
```
a_vec3_vertex        {itemSize:3, dataType:22, stride:12, offset:0, normalized:true}
a_float_visibility   {itemSize:1, dataType:21, stride:0,  offset:0}
```
The vertex shader resolves it as:
```glsl
vec4 get_clipspace(const vec3 vertex, const float flat_z) {
    vec3 pos = is_flat_mode() ? vec3(vertex.xy, flat_z) : DECODE_ECEF(vertex);
    return get_clipspace(pos);      // u_mat4_flat_mvp * vec4(pos,1)
}
...
gl_Position = get_clipspace(a_vec3_vertex, u_float_floor_elevation);
v_vec2_texcoord = fract(abs((a_vec3_vertex.xy - 0.25) * 2.));
```
i.e. `vertex.xy` is already **engine world space** in 12 packed bytes (3×4 B) with a
private quantization (`dataType:22, normalized:true`). Confirmed dead ends:
- buffer bytes at stride 12 do not read as float32 positions (`Uint32` triple
  `[0x70060A36, 0, 0xFFFFFFFF]`);
- no candidate decode (`u32/2^32`, `u16/65535`, 2:10:10:10, …) produced `|ndc|<=1`
  for a single vertex;
- `_initData` on the GL buffer wrapper is `null` (CPU copy dropped), and
  `gl.getBufferSubData` returns the same packed bytes.

**Conclusion: build collisions from the instanced GLB objects instead (§3.6), which
store exact world-space instance transforms and per-model metric bounding boxes.**

### 3.4 Style layer registry & sublayer names

```js
const style = mapgl._impl.core.modules.styleManager.getStyle(1);
style.layers.length === 2999;
style.layerIdToInnerId        // { "124": 1970, "342": 921, ... }  id-string → innerId
style.graphicsPresets         // { light, normal, immersive }
```

`getStyleLayer(id)` keys off **innerId**, not the string id. Filters reference
`db_sublayer`, whose match values are **`Set`s** (so `JSON.stringify` prints `{}` —
use `[...set]`):

```js
L.filter.cases[0].values instanceof Set
[...L.filter.cases[0].values]  // fences → ["Fence","Temporary_fence","Low_fence"]
```

Verified collision-relevant sublayers → innerId:

| sublayer(s) | innerId | type | zoom |
|---|---|---|---|
| `Roadbed`, `Main_Roadbed`, `Parking_Roadbed`, `PhysicalBarrier_Roadbed` | 309 / 313 | polygon | 16+ |
| `Pedestrian_road`, `Pedestrian_street_bad_road` | 181–183 | line | — |
| `Pedestrian_road_stairs` | 83/84, `stairs` 317 | dashedLine | 15.5+ |
| `Parking_area` | 117 | polygon | — |
| `Water_area` | 103–106, 14 | polygon | — |
| `Internal_lawn`, `Flowerbed_quarter`, `Internal_forest_quarter`, `Forest_quarter` | 74 / 79 / 75 / 56 | polygon | — |
| `Dwelling_house`, `Administrative_house`, `Technical_house`, `Private_house`, `Floor_plan_house`, `Momrah_building`, `Underground_house` | 158–172, 310 | polygon | 14–16 |
| building **roofs** (`*_house_roof`) | 955, 959, 962, 965 | mesh (program `mesh`/`diffuse`) | 16 |
| `Fence` (flat 2D strokes) | `fences` = 319 | line | 15.8–16.5 |
| **`Fence` (3D panels)** | 1169 / 1172 / 1173 / 1174 | gltfModel (instanced) | 16+ |
| `Porch` | 1161 | gltfModel | 16+ |
| `Lamppost_Point3D` / `_LD_` / `_HD_` | 1178 / 1179 / 1181 | gltfModel | 16+ |
| `Bench_with_back_Point3D` / `Bench_sans_back_Point3D` | 1189 / 1190 | gltfModel | 16+ |
| `Swing_Point3D` / `Swing_bench_3D` | 1182 / 1242 | gltfModel | 16+ |
| `Model_tree_{coniferous,pine,birch,deciduous,deciduous_low,deciduous_growth,shrubs,apple,mimosa,sakura,willow,…}_point` | 797/801/906/908/910/912/918/926/928/… | gltfModel | 16+ |
| `Immersive_model`, `Immersive_model_multipart` | 971 | gltfModel | 14+ |
| `Road_support_column` | 493 | gltfModel | 16+ |
| `Kiosk`, `Barrier`, `Dogzone_barrier_3D`, `Poi_trash`, `Rectangular_canopy_solid_wall` | (sublayer present, model layers) | gltfModel | 16+ |

Snippet to build the map (run once after style load):

```js
function buildSublayerIndex(style) {
  const out = {};
  for (const L of style.layers) {
    const subs = new Set();
    (function walk(n){
      if (!n || typeof n !== 'object') return;
      if (n.type === 'match' && n.cases)
        for (const c of n.cases)
          if (c.values instanceof Set && n.input && n.input.property === 'db_sublayer')
            c.values.forEach(v => subs.add(v));
      for (const k of Object.keys(n)) walk(n[k]);
    })(L.filter);
    out[L.innerId] = [...subs];
  }
  return out;
}
```

### 3.5 World coordinate space

All geometry lives in the engine's 2^32 Mercator space (`ECEF_WORLD = 4294967296.`
in the shaders). Example tile mesh matrix, `Ep.renderModelMatrix`, coords
`[28192,23632,15,17]`:

```js
Float64Array([ 262140,0,0,0,   0,262140,0,0,   0,0,2097120,0,
               1547632644, 949944324, 0, 1 ])
// world = M[12] + local01 * M[0]   (local01 ∈ [0,1] over a 2-tile metatile block)
// => 2^32-normalised mercator: mex = worldX/2^32 + 0.5 ; lng = mex*360 - 180
```
`Ep` tile meshes also expose `renderMvpMatrix`, `renderDemMatrix`,
`renderFlatMapTexMatrix`, `mvpMatrices` (Map), `modelMatrices` (Map), `size: 131072`,
`purpose: 'geojson' | 'zenith' | 'dynamicObject'`.

### 3.6 ★ Instanced GLB objects — the collision source (verified)

At `zoom 17.5`, `pitch 45`, the viewport contained **104 instanced buckets**:

| sublayer | innerId | buckets | instances | verts/bucket | bboxDiag (m) |
|---|---|---|---|---|---|
| Fence | 1169 | 10 | **7413** | 588 | 1.93 |
| Model_tree_shrubs_point | 908 | 4 | 555 | 1806 | 10.0 |
| Model_tree_birch_point | 912 | 3 | 181 | 7164 | 23.6 |
| Model_tree_deciduous_low_point | 910 | 4 | 136 | 3240 | 19.7 |
| Porch | 1161 | 40 | 121 | 12000 | 3.28 |
| Model_tree_deciduous_growth_point | 918 | 3 | 112 | 1650 | 11.4 |
| Lamppost_Point3D | 1178 | 3 | 99 | 2376 | 4.11 |
| Lamppost_LD_Point3D | 1179 | 3 | 65 | 5220 | 4.69 |
| Model_tree_deciduous_point | 906 | 3 | 65 | 4950 | 22.3 |
| Model_tree_coniferous_point | 797 | 2 | 58 | 2724 | 26.1 |
| Bench_with_back_Point3D | 1189 | 3 | 46 | 2268 | 2.40 |
| Bench_sans_back_Point3D | 1190 | 3 | 30 | 2610 | 2.08 |
| Immersive_model (buildings) | 971 | 10 | 10 | 94038 | 57.3 |
| Swing / Swing_bench / HD lamp / mimosa / apple / pine | 1182/1242/1181/928/926/801 | — | 2–17 | — | 4.5–32.7 |

Per-bucket static description (verified sample, `Bench_with_back`, layerId 1189):

```js
child = {
  id: 2317, type: 0, count: 756, instanceCount: 33, drawMode: 4,
  layerSettings: { programName: 'gltfModel', is3dMapAware: true },
  bbox:      { min:[-0.9500001, 0, -0.5266330],
               max:[ 0.9500001, 1.1673702, 0.3476025] },   // metres, model space
  bboxWorld: { min:[1547702587.06, 950010411.06, -352.94],
               max:[1547823720.94, 950140984.94,  352.94] },
  meta:      { buildingId:'-1', sublayer: undefined },
  attributes: {
    layerId: 1189, styleId: 1, bboxDiag: 2.3952122620144665,
    centroid: [0, -0.08951525390148163],
    lngLat: [],            // empty for instanced batches (per-instance data is in the VAO)
    modelIndices: [51], tileData: [], sourceName: 'gltfModels', demPosition: 1
  }
}
```
Style layer for it:
```
id '280048'  innerId 1189  type 'gltfModel'  minzoom 16
  modelSrc: 'bench1'
  scale:  1
  rotation: ['literal-array',[0,0,['+',[180,['coalesce',[['get','db_model_rotation_angle'],
                                                           ['get','db_rotation_angle'],0]]]]]]
```
Compare: `Fence` panel model `fencedefault`, `bbox {min:[-0.75,0,-0.135], max:[0.75,1.1765,0.13499]}`,
`style.scale = [1,1,1.5]` → a 1.5 m × 1.18 m panel. Buildings: `model_src`/`tileData`
e.g. `['50/administration.glb','50/administrationlod.glb','7037510072928748']`,
`meta.sublayer='Immersive_model'`, `meta.buildingId`.

#### Per-instance vertex layout (stride **64 bytes**) — verified

```js
child.vao._attributes
  a_vec3_instance_position   {itemSize:3, dataType:22, stride:64, offset:0,  normalized:true,  instanceDivisor:1}
  a_mat3_instance_matrix     {itemSize:9, dataType:20, stride:64, offset:8,  normalized:false, instanceDivisor:1}
  a_float_abs_z              {itemSize:1, dataType:20, stride:64, offset:44}
  a_float_instance_height    {itemSize:1, dataType:20, stride:64, offset:48}
  a_vec4_instance_localid    {itemSize:4, dataType:21, stride:64, offset:52, normalized:true}
  + non-instanced glTF mesh attrs: position(3f), normal(3f), texcoord_0/1/2(2f), tangent(4f)
```
Decoded record (bench, instance 0):
```
i16 @0  : [-18009, 32037, 0]
mat3 @8 : [227.595, 19.912, 0,  3e-15, 3e-15, 228.465,  19.912, -227.595, 3e-15]
absZ @44: 0     height @48: 0     localId @52: [NaN, NaN, 0, 3.44e36]   // NaN = 0xFFFF sentinel
```

Shader use (definitive, from `gltfModel` vertex shader):
```glsl
vec4 center = instance_model_matrix * vec4(u_vec2_anchor.x, 0, u_vec2_anchor.y, 1);
center *= u_mat4_instance;
center.xy += a_vec3_instance_position.xy;
```
so instance position is a **world-space offset**; anchor = batch anchor uniform
(`u_mat4_instance` = tile `renderModelMatrix`).

#### Decode recipe (verified numerically)

```js
const M = tileMesh.renderModelMatrix;       // Float64Array(16), per replica
const n01x = (i16[0] / 32768 + 1) / 2;      // 0..1
const n01y = (i16[1] / 32768 + 1) / 2;
const worldX = M[12] + n01x * M[0];
const worldY = M[13] + n01y * M[5];
```
Cross-check by fitting the bucket bbox against all instances
(`s = (bboxWorld.max.x-bboxWorld.min.x)/(i16max-i16min)`) gave
`s ≈ 2.012` for the 3432-panel fence bucket and `2.591/1.865` for sparse buckets,
versus `M[0]/131072 = 2.000` and anchor `M[12] + M[0]/2 = 1547763714`
(fit: `1547763726`) — i.e. the transform above is the engine's, and residual error
comes from `bboxWorld` not covering every instance.
World→lng/lat (x is exact, y needs a per-tile offset because the metatile origin is
not the tile's top edge — calibration below):

```js
const worldToLL = (wx, wy, yBias = 0) => {
  const mx = wx / 4294967296 + 0.5;
  const my = wy / 4294967296 + 0.5 + yBias;
  return [ mx * 360 - 180,
           Math.atan(Math.sinh(Math.PI * (2 * my - 1))) * 180 / Math.PI ];
};
// calibrate yBias once: take a mesh, its bboxWorld centre, and photogrammetric
// ground truth from mapgl.project()/unproject() on the same tile, solve for the offset.
```
For collision maths you do **not** need lng/lat at all: run physics in world units
(1 world unit ≈ 1/2^32 of the Mercator world). At lat 62°, 1 m ≈ 10.9 world units at
detail 17 (tile world span 131072 ≈ 12 km), so keep separate metric scale constants
per zoom/detail level, or convert through `Mercator.scaleFactor` semantics used by
`getElevationAtTier`.

#### Per-instance rotation/scale

`mat3 @8` is `[m00 m01 m02  m10 m11 m12  m20 m21 m22]`; e.g. bench
`[227.6, 19.9; 19.9, -227.6]` → `|scale| ≈ 228.5` (metres, since the model is ~1.9 m
wide and the matrix is applied to model-space vertices), `θ = atan2(m10, m00)`.
For boxes use `atan2(b, a)` plus `Math.hypot(a, b)` as the scale factor.

### 3.7 Ready-to-use extractor (verified code, returns compact JSON)

```js
async function extractCollisionObjects() {
  const m = window.mapgl;
  const md = m._impl.core.modules;
  const style = md.styleManager.getStyle(1);
  const subById = buildSublayerIndex(style);           // §3.4
  const groups = {};

  for (const tl of md.tileManager.tileLayers) {
    for (const key of Object.keys(tl.gridState.tiles)) {
      const mod = tl.gridState.tiles[key].currentMod;
      if (!mod || !mod.objects) continue;
      for (const obj of mod.objects) {
        const M = obj.renderModelMatrix;
        for (const c of (obj.children || [])) {
          if (c.layerSettings.programName !== 'gltfModel' || !c.instanceCount) continue;
          const a = c.attributes, sub = (subById[a.layerId] || ['?'])[0];
          if (!groups[sub]) groups[sub] = { sub, layerId: a.layerId, bbox: c.bbox,
                                            bboxDiag: a.bboxDiag, objects: [] };
          const at = c.vao._attributes['a_vec3_instance_position'];
          const b  = at._buffer, gl = b._gl;
          const n  = c.instanceCount, raw = new ArrayBuffer(64 * n);
          gl.bindBuffer(gl.ARRAY_BUFFER, b._glBuffer);
          gl.getBufferSubData(gl.ARRAY_BUFFER, 0, new Uint8Array(raw));
          const i16 = new Int16Array(raw), f32 = new Float32Array(raw);
          for (let i = 0; i < n; i++) {
            const o = i * 16;                                    // 64 B = 16 int16
            const nx = (i16[o] / 32768 + 1) / 2, ny = (i16[o+1] / 32768 + 1) / 2;
            const m00 = f32[o+2], m10 = f32[o+3];
            groups[sub].objects.push({
              wx: M[12] + nx * M[0],
              wy: M[13] + ny * M[5],
              rot: Math.atan2(m10, m00),                          // radians
              scale: Math.hypot(m00, m10) || 1,
              h: f32[o+12]                                        // instance height
            });
          }
        }
      }
    }
  }
  return groups;
}
```

### 3.8 Buildings

* `Immersive_model` (innerId 971, gltfModel, z14+): one bucket per landmark building.
  `meta.buildingId`, `meta.sublayer`, `attributes.tileData = [lodSrc, modelSrc, buildingId]`,
  `bbox` (metres) and `bboxWorld` (world AABB) → OBB from `bbox` + instance `rot`.
* Flat footprint polygons exist only at z ≤ 16 (`Dwelling_house` 158/168, `Private_house`
  171/172, `Administrative_house` 158/159, `Technical_house` 160/162, `layer 310` with
  `db_height < 10` filter) and at z16 as extruded `mesh`/`diffuse` buckets
  (955/959/962/965) with a `side` attribute separating roofs from walls — the roof
  bucket is the footprint outline.
* Building ids/heights are also available via the identify buffers
  (`co.identifyIds.idBuffer` / `centerBuffer`) and the `db_height` attribute used by the
  style filters.

---

## 4. Canvas overlay / custom rendering

### 4.1 DOM around the map canvas (verified)

```
#map  (div, position:absolute, 1036×655)
└ div (position:relative, overflow:hidden, 1036×655)
  └ div (position:relative, 1036×655)
    └ canvas            (display:block, 1036×655)          ← main
    └ canvas            (position:absolute; left:0; top:0; pointer-events:none; display:none)  ← identify
#map is inside div._1tpf7zu { position:fixed, z-index:auto }
body > div (position:absolute, inset 0, pointer-events:none) — portal/anchor layer
```
All ancestors use `z-index:auto` and `pointer-events:auto`; nothing above the canvas is
transparent-and-click-through, so an overlay must set `pointer-events:none` itself.

**Overlay recipe (recommended):**
```js
const host = mapgl.getCanvas().parentElement;      // div position:relative
const cv = document.createElement('canvas');
Object.assign(cv.style, { position:'absolute', inset:'0', width:'100%', height:'100%',
                          pointerEvents:'none', zIndex:'1' });
host.appendChild(cv);
// size with DPR, project with mapgl.project(); its output is canvas-space CSS px
const dpr = devicePixelRatio;
cv.width = mapgl.getCanvas().width; cv.height = mapgl.getCanvas().height;   // already DPR-scaled
const ctx = cv.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
const [sx, sy] = mapgl.project([lng, lat]);
```
Because `project()` includes `viewport.left` (416), sprite placement on this canvas needs
no extra offset — verified `project(center) = [726, 327.5]` for a 1036×655 canvas.

### 4.2 Custom WebGL layers ARE supported

```js
mapgl.addLayer(layerStyleJson, renderFn)      // () => { this.addDraftLayer(e,t); return this }
mapgl._impl.addLayer(e,t) {
  if (e.type === 'custom') this.state.aaMode = undefined;
  this.modules.styleManager.addLayer(e,t);
  this.core.activateStyleUpdating();
}
styleManager.addLayer(...)  // requires style loaded; throws "The layer id must be set."
                            // and "The layer with id «x» already exists in the map style."
styleManager.initCustomLayer(styleId, innerLayer, renderFn, onRemove, onInit) {
  this.customLayers.set(innerLayer.innerId, {
    sceneObject:{ type: SceneObjectType.Custom, attributes:{styleId, layerId}, tile:{zoomLevel:0},
                  layerSettings:{}, canRender:true },
    layer: innerLayer, renderFunction: renderFn });
}
```
`styleManager.customLayers` is a `Map` (empty by default; `hasCustomLayers() === false`).
GL context is shared (`getWebGLContext() === renderer._gl`, WebGL2), so a custom layer
renders inside MapGL's own frame and you get correct depth/compositing — but any GL
state you touch must be restored (`renderer.resetStateAfterExternalRender()` exists).
For a first version, the 2D overlay canvas is less invasive and is what I recommend;
upgrade to a custom layer only if you need 3D-consistent occlusion.

### 4.3 Heavy renderer hooks available

`_impl.core.modules.renderer`: `_gl`, `_canvasElement`, `_size`, `getDrawTargetFramebuffer`,
`getMapMeshFramebufferId`, `getMapMeshIdFramebufferId`, `renderIdentify`, `readPixelsFloat`,
`applyGpuState`, `resetStateAfterExternalRender` — enough for a screen-space collision
mask if you ever want raster-based collision instead of analytic OBBs.

---

## 5. GTA mode / easter eggs — none

* `initialState.data.gta` **exists but is geotargeted advertising**:
  `{ "<uuid>": { banners:[{ point, name_ex, segment_id, region_id, adm_div[], hash,
  reviews, ad_attributes, address, main_rubric_id, org }] } }` — not a game mode.
* No `GTA` in URL or body text; the only modes are graphics presets
  `['light','normal','immersive']` (`styleState.graphicsPreset = 'immersive'`,
  `immersiveRoadsOn = true`, `globeEnabled = true`, `terrainEnabled = false`).
* Other globals: `initialState.{bss,data,session,status,appContext}`,
  `_mapgl_d`, `__mapglPlugins`, `__REACT_QUERY_STATE__`.

---

## 6. Practical architecture for the userscript

1. `@run-at document-idle`; poll `window.mapgl` (`setInterval`, 100 ms) until
   `mapgl._impl.core` exists. Never `defineProperty` on it (verified breakage).
2. Read `mapgl.getCanvas().parentElement`; append a `pointer-events:none` 2D canvas.
3. Game loop in `requestAnimationFrame`:
   - physics in world/lng-lat metres;
   - `mapgl.setCenter(playerLL, {duration:0})`, `setPitch`, `setRotation`, `setZoom`
     each frame (all synchronous — verified);
   - sprites at `mapgl.project([lng,lat])`.
4. Collision build (once per camera move / tile change, throttled):
   - `extractCollisionObjects()` (§3.7) → OBB/cylinder list from
     `instance position + mat3 rotation + child.bbox × style.scale`;
   - buckets keyed by `tileLayers[*].gridState.tiles`; rebuild only for the 4–8 visible
     tiles; drop instances outside a ~300 m radius;
   - buildings: `Immersive_model` OBBs from `bbox`/`bboxWorld`; optionally exact
     footprints from z16 roof meshes or polygon layers 158–172.
5. Player controller: car = kinematic bicycle in metres; foot = capsule with step-up
   (use `mapgl.getElevationAtTier` / `getGroundPoint` when DEM is enabled); collision
   response = push-out along the OBB normal (SAT), gravity + jump for foot mode.
6. Freeze the page's own gestures while driving: `mapgl.blockInteraction()` or
   `mapgl.setOption('disableDragging', true)`; the `handler` module
   (`_impl.core.modules.handler`) exposes `block()`/`unblock()`.

### Known gaps / risks
* The 2D packed vertex buffers (roads, water, flat fences at z<16) are quantized with a
  private 12-byte codec (`dataType:22`) whose unpack step lives only in the GLSL
  (`u_mat4_flat_mvp`). Use instanced GLBs (z ≥ 16) for collision; treat flat polygons as
  visual-only.
* World→lng/lat y-offset needs a one-time calibration per tile/replica (x maps exactly
  with `world/2^32 + 0.5`; y carries a metatile-origin bias). Prefer staying in world
  units and only converting the player.
* `window.mapgl` is a bundle-assigned global; ad-blockers/AB variants that fail to load
  `map3d.<hash>.js` leave it undefined (observed once after a hook-induced crash).
* `collectorOutput.data[].buffer` is uploaded verbatim; `_initData` is null, so capture
  must go through `gl.getBufferSubData` (used above) or by hooking `bufferData` before
  upload.
