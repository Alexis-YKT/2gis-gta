#!/usr/bin/env node
'use strict';

// Concatenates the Tampermonkey metadata header and the ordered modules into a
// single strict-mode IIFE, writes the userscript, then verifies its syntax.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const OUT_PATH = path.join(ROOT, '2gis-gta.user.js');
const VERSION = '0.5.0';
// Collision modules must load before overlay/hud/main; player-gl.js precedes overlay.js.
const MODULES = [
  'src/probe.js',
  'src/collision-extract.js',
  'src/collision.js',
  'src/player-gl.js',
  'src/vehicle.js',
  'src/vehicle-gl.js',
  'src/overlay.js',
  'src/camera-player.js',
  'src/hud.js',
  'src/main.js',
];

function readInput(relPath) {
  const absPath = path.join(ROOT, relPath);
  if (!fs.existsSync(absPath)) throw new Error(`Missing input file: ${relPath}`);
  const text = fs
    .readFileSync(absPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trimEnd();
  if (!text) throw new Error(`Empty input file: ${relPath}`);
  return text;
}

const countLines = (text) => text.split('\n').length;

function build() {
  const meta = readInput('src/meta.js').replace(/^\/\/ @version\s+\S+$/m, `// @version      ${VERSION}`);
  const chunks = [
    meta,
    '',
    '(function () {',
    "  'use strict';",
    "  const WIN = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;",
    '  const GTA = (WIN.__GTA2GIS__ = WIN.__GTA2GIS__ || {});',
    `  GTA.version = '${VERSION}';`,
  ];
  const stats = [];
  for (const relPath of MODULES) {
    const code = readInput(relPath);
    chunks.push('', `// --- ${relPath} ---`, code);
    stats.push({ relPath, lines: countLines(code) });
  }
  chunks.push('})();', '');
  const output = chunks.join('\n');
  fs.writeFileSync(OUT_PATH, output, { encoding: 'utf8' });
  return { output, stats };
}

function syntaxCheck() {
  try {
    execFileSync(process.execPath, ['--check', OUT_PATH], { stdio: 'inherit' });
  } catch (err) {
    throw new Error(`Syntax check failed (exit ${err.status}) for ${path.basename(OUT_PATH)}`);
  }
}

try {
  const { output, stats } = build();
  syntaxCheck();
  for (const { relPath, lines } of stats) console.log(`  ${relPath.padEnd(24)} ${lines} lines`);
  console.log(`  ${'total'.padEnd(24)} ${countLines(output)} lines`);
  console.log(`  ${'output'.padEnd(24)} ${Buffer.byteLength(output, 'utf8')} bytes -> ${path.basename(OUT_PATH)}`);
  console.log('SYNTAX OK');
} catch (err) {
  console.error(`[build] ERROR: ${err.message}`);
  process.exit(1);
}
