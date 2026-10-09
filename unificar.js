// ═══════════════════════════════════════════════════════════
//  UNIFICAR V2 — Cabañas Catamarca
//  Lee dist/index.html (source of truth, SIN minificar — corre antes
//  que minify.js dentro de `npm run build`) y genera los 3 parciales
//  de Google Apps Script (gitignoreados, solo para `clasp push`):
//    - style.html        (solo CSS extraído)
//    - script.html       (solo JS app-logic extraído)
//    - index-gas.html    (template con includes GAS)
//
//  Uso: node unificar.js
//  Sin dependencias externas — solo fs y path
//  unificarFrom(inputPath, outputs) — exportado para tests
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

function unificarFrom(inputPath, outputs) {
  // ── Leer fuente única de verdad ────────────────────────────
  const html = fs.readFileSync(inputPath, 'utf8');

  // ── 1. Extraer CSS: todos los <style>...</style> ──────────
  const styleRegex = /<\s*style\s*>([\s\S]*?)<\/style\s*>/gi;
  const styleBlocks = [];
  let match;
  while ((match = styleRegex.exec(html)) !== null) {
    styleBlocks.push(match[1]);
  }
  const styleContent = styleBlocks.join('\n\n');

  const styleHeader = [
    '/* ═══════════════════════════════════════════════════════',
    '   Generado automáticamente por unificar.js',
    '   NO editar manualmente — los cambios se pierden',
    '   ═══════════════════════════════════════════════════════ */',
    ''
  ].join('\n');

  fs.writeFileSync(outputs.style, styleHeader + styleContent, 'utf8');

  // ── 2. Extraer scripts: identificar 1ro (config) y 2do (app logic) ─
  const scriptRegex = /<\s*script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;
  const scriptBlocks = [];
  while ((match = scriptRegex.exec(html)) !== null) {
    scriptBlocks.push(match[1]);
  }

  if (scriptBlocks.length < 2) {
    throw new Error('se esperaban al menos 2 bloques <script> en el HTML');
  }

  const scriptContent = scriptBlocks[1]; // 2do script = app logic (índice 1)

  const scriptHeader = [
    '// ═══════════════════════════════════════════════════════',
    '//  Generado automáticamente por unificar.js',
    '//  NO editar manualmente — los cambios se pierden',
    '// ═══════════════════════════════════════════════════════',
    ''
  ].join('\n');

  fs.writeFileSync(outputs.script, scriptHeader + scriptContent, 'utf8');

  // ── 3. Generar index-gas.html ─────────────────────────────
  let gasContent = html;

  // 3a. Reemplazar TODOS los <style>...</style> por include
  gasContent = gasContent.replace(
    /<\s*style\s*>[\s\S]*?<\/style\s*>/gi,
    '<?!= include(\'style\') ?>'
  );

  // 3b. Reemplazar SOLO el 2do <script>...</script> por include
  let scriptIndex = 0;
  gasContent = gasContent.replace(
    /<\s*script\b[\s\S]*?<\/script\s*>/gi,
    (m) => {
      scriptIndex++;
      if (scriptIndex === 2) return '<?!= include(\'script\') ?>';
      return m; // 1er script (config vars) queda inline
    }
  );

  const gasHeader = [
    '<!-- ═══════════════════════════════════════════════════════',
    '     Generado automáticamente por unificar.js',
    '     NO editar manualmente — los cambios se pierden',
    '     ═══════════════════════════════════════════════════════ -->',
    ''
  ].join('\n');

  fs.writeFileSync(outputs.gas, gasHeader + gasContent, 'utf8');

  return { styleBlocks: styleBlocks.length, scriptBlocks: scriptBlocks.length };
}

if (require.main === module) {
  const result = unificarFrom(path.resolve('dist/index.html'), {
    style:  path.resolve('style.html'),
    script: path.resolve('script.html'),
    gas:    path.resolve('index-gas.html'),
  });
  console.log('✅  style.html generado (' + result.styleBlocks + ' bloque(s))');
  console.log('✅  script.html generado');
  console.log('✅  index-gas.html generado');
  console.log('\n🎉 Todos los archivos generados correctamente.');
}

module.exports = { unificarFrom };
