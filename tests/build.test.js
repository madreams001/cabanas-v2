// ═══════════════════════════════════════════════════════════
// TEST V2 DE INTEGRACIÓN DEL PIPELINE DE BUILD
//
// El refactor de unificación vive en el build: logic.js se inlina
// dentro de un IIFE ANTES de app.js, en UN solo <script>. Si el
// build rompe ese contrato (IIFE fuera, orden invertido, logic.js
// omitido, más/menos de 2 scripts), la app muere en producción
// (GitHub Pages + GAS) sin que los tests de paridad se enteren.
//
// V2: además se verifica la inyección build-time de APP_CONFIG
// (apiUrl + writeToken desde opts/config.local.json) y que NO queden
// secretos hardcodeados V1 en el HTML generado.
//
// Este test corre build.js y unificar.js REALES sobre archivos
// temporales (nunca toca los artefactos trackeados del repo) y
// verifica los invariantes del pipeline.
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildTo } = require('../build');
const { unificarFrom } = require('../unificar');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cabanas-build-test-'));

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const INDEX_HTML = path.join(TMP, 'index.html');
const TEST_CFG = { apiUrl: 'https://example.com/exec', writeToken: 'tok-de-prueba' };

describe('build.js → index.html generado', () => {
  let html;

  beforeAll(() => {
    html = buildTo(INDEX_HTML, TEST_CFG);
  });

  it('genera exactamente 2 bloques <script> (config + lógica unificada)', () => {
    const scripts = html.match(/<\s*script\b[\s\S]*?<\/script\s*>/gi) || [];
    expect(scripts).toHaveLength(2);
  });

  it('expone window.Logic ANTES de que app.js lea MESES', () => {
    const logicIdx = html.indexOf('window.Logic = logicApi');
    const mesesIdx = html.indexOf('const MESES = Logic.MESES');
    expect(logicIdx).toBeGreaterThan(-1);
    expect(mesesIdx).toBeGreaterThan(logicIdx);
  });

  it('inlinea logic.js dentro de un IIFE y app.js después', () => {
    const iifeIdx = html.indexOf('(function() {');
    const appIdx = html.indexOf('const MESES = Logic.MESES');
    expect(iifeIdx).toBeGreaterThan(-1);
    expect(appIdx).toBeGreaterThan(iifeIdx);
  });

  it('el 2do script compila como JavaScript sin errores de sintaxis', () => {
    const scripts = html.match(/<\s*script\b[\s\S]*?<\/script\s*>/gi) || [];
    const secondScript = scripts[1].replace(/^[\s\S]*?>/, '').replace(/<\/script\s*>$/, '');
    expect(() => new Function(secondScript)).not.toThrow();
  });

  it('inyecta apiUrl y writeToken en APP_CONFIG (build-time)', () => {
    expect(html).toContain('https://example.com/exec');
    expect(html).toContain('tok-de-prueba');
    expect(html).not.toContain('__API_URL__');
  });

  it('no deja secretos hardcodeados V1 en el HTML generado', () => {
    expect(html).not.toContain('CabanasCatamarca2026');
    expect(html).not.toContain('AKfycby1PCqi24Y8U88eO54ZjKYrpJRTxjsUX9YfJtuaCTj');
  });

  it('incluye el meta CSP restrictivo', () => {
    expect(html).toContain('Content-Security-Policy');
  });
});

describe('unificar.js (GAS) con el index.html generado', () => {
  const OUTS = {
    style:  path.join(TMP, 'style.html'),
    script: path.join(TMP, 'script.html'),
    gas:    path.join(TMP, 'index-gas.html'),
  };
  let result;

  beforeAll(() => {
    result = unificarFrom(INDEX_HTML, OUTS);
  });

  it('extrae el 2do script con la lógica unificada', () => {
    const script = fs.readFileSync(OUTS.script, 'utf8');
    expect(script).toContain('window.Logic = logicApi');
    expect(script).toContain('Logic.normalizarFecha');
  });

  it('index-gas.html reemplaza solo el 2do script por include', () => {
    const gas = fs.readFileSync(OUTS.gas, 'utf8');
    const includes = gas.match(/include\('script'\)/g) || [];
    expect(includes).toHaveLength(1);
    // La lógica (2do script) quedó extraída: no puede estar inline.
    expect(gas).not.toContain('Logic.normalizarFecha');
    // El config (1er script) sigue inline.
    expect(gas).toContain('APP_CONFIG');
  });
});
