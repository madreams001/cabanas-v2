// ═══════════════════════════════════════════════════════════
//  MINIFY V2 — Cabañas Catamarca
//  Minifica dist/index.html EN EL LUGAR (único artefacto, sin duplicado
//  index.min.html vs minis/). Corre dentro de `npm run build` DESPUÉS de
//  unificar.js (los parciales GAS se extraen del HTML sin minificar).
//  Uso: node minify.js
// ═══════════════════════════════════════════════════════════

const { minify } = require('html-minifier-terser');
const fs = require('fs');
const path = require('path');

const inputFile = path.resolve('dist/index.html');

if (!fs.existsSync(inputFile)) {
  console.error(`❌ No se encontró ${inputFile} (corré node build.js primero)`);
  process.exit(1);
}

const originalSize = fs.statSync(inputFile).size;
const inputContent = fs.readFileSync(inputFile, 'utf8');

console.log('🚀 Minificando dist/index.html con html-minifier-terser...\n');

minify(inputContent, {
  collapseWhitespace: true,
  removeComments: true,
  removeOptionalTags: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeTagWhitespace: true,
  useShortDoctype: true,
  minifyCSS: true,
  minifyJS: true,
  collapseBooleanAttributes: true,
  conservativeCollapse: true,
  decodeEntities: true,
}).then((minified) => {
  fs.writeFileSync(inputFile, minified, 'utf8');

  const minSize = fs.statSync(inputFile).size;
  const saved = originalSize - minSize;
  const savings = ((saved / originalSize) * 100).toFixed(1);

  console.log('✅ Minificación exitosa!');
  console.log(`📄 Original: ${(originalSize / 1024).toFixed(1)} KB`);
  console.log(`📦 Minificado: ${(minSize / 1024).toFixed(1)} KB`);
  console.log(`💾 Ahorro: ${savings}%`);
  console.log(`📁 Artefacto único: ${inputFile}`);
}).catch((err) => {
  console.error('❌ Error durante la minificación:');
  console.error(err.message);
  process.exit(1);
});
