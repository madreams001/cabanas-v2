/**
 * build.js V2 — Inline CSS/JS from src/ into dist/index.html + inyecta
 * config build-time desde config.local.json (gitignoreado, ver
 * config.example.json). NUNCA commitear secretos.
 *
 * Reads:  src/index.html  (references style.css + app.js externally)
 *         src/style.css
 *         src/logic.js    (lógica pura, se inlinea PRIMERO dentro de un IIFE)
 *         src/app.js
 *         config.local.json (opcional; { apiUrl, writeToken })
 * Writes: dist/index.html  (everything inlined, listo para unificar+minify)
 *
 * El JS final queda en UN solo <script>: primero logic.js (aislado en un IIFE
 * que expone window.Logic) y después app.js.
 *
 * Usage:  node build.js
 *         buildTo(outPath, opts?)  — exportado para tests (tests/build.test.js)
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const LOCAL_CONFIG = path.join(__dirname, 'config.local.json');
const APP_CONFIG_MARKER = "window.APP_CONFIG = { apiUrl: '__API_URL__' };";

/**
 * Safe string replace — avoids $1, $&, $', etc. interpretation
 * when the replacement contains dollar signs.
 */
function safeReplace(str, search, replacement) {
  const idx = str.indexOf(search);
  if (idx === -1) return str;
  return str.slice(0, idx) + replacement + str.slice(idx + search.length);
}

function jsStr(s) {
  return "'" + String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function loadLocalConfig() {
  // Orden: config.local.json > env (CI: secrets.V2_API_URL) > vacío.
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(LOCAL_CONFIG, 'utf8'));
  } catch (e) { /* ausente: ok en CI */ }
  return {
    apiUrl: fileCfg.apiUrl || process.env.API_URL || '',
    writeToken: fileCfg.writeToken || process.env.WRITE_TOKEN || '',
  };
}

/**
 * Genera el dist/index.html con CSS/JS inline + config inyectada y lo
 * escribe en outPath. Devuelve el contenido generado (útil para tests).
 * opts { apiUrl, writeToken } pisa config.local.json (tests).
 */
function buildTo(outPath, opts) {
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const css  = fs.readFileSync(path.join(SRC, 'style.css'),  'utf8');
  const logicJs = fs.readFileSync(path.join(SRC, 'logic.js'), 'utf8');
  const js   = fs.readFileSync(path.join(SRC, 'app.js'),     'utf8');

  // 1) Replace <link rel="stylesheet" href="style.css"> with inline <style>
  const LINK_MARKER  = '<link rel="stylesheet" href="style.css">';
  let out = safeReplace(html, LINK_MARKER, '<style>\n' + css + '\n</style>');

  // 2) Replace <script src="app.js"></script> with inline <script>
  //    logic.js va primero, envuelto en un IIFE para no pisar el scope de app.js.
  const SCRIPT_MARKER = '<script src="app.js"></script>';
  const inlineJs = '(function() {\n' + logicJs + '\n})();\n\n' + js;
  out = safeReplace(out, SCRIPT_MARKER, '<script>\n' + inlineJs + '\n</script>');

  // 3) V2: inyectar config build-time (apiUrl + writeToken) en APP_CONFIG.
  const cfg = Object.assign(loadLocalConfig(), opts || {});
  if (!cfg.apiUrl && require.main === module) {
    console.log('⚠️  config.local.json ausente o sin apiUrl — se genera con URL vacía.');
  }
  const appConfigLiteral =
    'window.APP_CONFIG = { apiUrl: ' + jsStr(cfg.apiUrl) +
    ', writeToken: ' + jsStr(cfg.writeToken) + ' };';
  out = safeReplace(out, APP_CONFIG_MARKER, appConfigLiteral);

  // 4) Write (crear dist/ si falta)
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, out, 'utf8');
  return out;
}

if (require.main === module) {
  const OUT = path.join(__dirname, 'dist', 'index.html');
  const out = buildTo(OUT);
  console.log('✅ build.js — dist/index.html generado con CSS/JS inline + config');
  console.log(`   src/logic.js + src/app.js → 1 bloque <script>`);
  console.log(`   dist/index.html (${out.length} bytes)`);
}

module.exports = { buildTo, safeReplace };
