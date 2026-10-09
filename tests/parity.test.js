// ═══════════════════════════════════════════════════════════
// GUARD DE UNIFICACIÓN: src/app.js vs src/logic.js
//
// Tras la Fase 2 (refactor), app.js NO implementa más estas
// funciones: delega en logic.js (fuente única, cargada por
// build.js como window.Logic). Este test garantiza que:
//
//   1. app.js no vuelva a duplicar implementaciones (wrappers cortos).
//   2. Los wrappers produzcan exactamente lo mismo que logic.js.
//   3. logic.js siga exportando la API completa.
//
// Si alguien reintroduce una implementación en app.js, el test
// falla y avisa.
// ═══════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const logic = require('../src/logic');

const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');

// Funciones que DEBEN estar unificadas (solo wrapper en app.js).
const WRAPPED_FNS = [
  'normalizarFecha', 'ds', 'fmtFecha',
  'nombreCabaña', 'tarifaCabaña', 'getReservaEn',
];

// ── Extracción: lista las FunctionDeclaration de app.js ──
function extractFns(src) {
  const ast = acorn.parse(src, { ecmaVersion: 'latest' });
  const found = {};
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration') found[node.id.name] = src.slice(node.start, node.end);
  }
  return found;
}

// ── Compilación: crea el wrapper "de navegador" con sus globales ──
function compile(fnSrc, globals = {}) {
  const params = Object.keys(globals);
  const factory = new Function(...params, `return (${fnSrc});`);
  return factory(...Object.values(globals));
}

const appFns = extractFns(APP_SRC);

// ── Helpers de fixtures ────────────────────────────────────
const defaultConfig = logic.crearConfigDefault();
const makeReserva = (overrides) => ({
  ID: 1, Cabaña: 'Cabaña 1', Tipo: 'Particular', Estado: 'Confirmada',
  Nombre: 'Juan Pérez', DNI_CUIT: '12345678', Telefono: '', Email: '',
  Direccion: '', Entrada: '2026-06-10', Salida: '2026-06-13',
  Noches: 3, Pago: '', Monto: 30000, Observaciones: '',
  NotaInterna: '', Socio: 'Cromi', Cargada: '22/5/2026 16:00:00',
  ...overrides,
});

// ── 1. Guardia anti-duplicación ────────────────────────────
describe('unificación: sin implementaciones duplicadas en app.js', () => {
  it.each(WRAPPED_FNS)('%s existe como wrapper corto a Logic.%s', (name) => {
    expect(appFns[name]).toBeDefined();
    expect(appFns[name].length).toBeLessThan(120);   // wrapper corto, no implementación
    expect(appFns[name]).toContain(`Logic.${name}`); // delega en logic.js
  });

  it('MESES no se redefine en app.js (alias a Logic.MESES)', () => {
    expect(APP_SRC).toContain('const MESES = Logic.MESES;');
    expect(APP_SRC).not.toContain("const MESES = ['Enero'");
  });
});

// ── 2. Los wrappers producen lo mismo que logic.js ─────────
describe('unificación: delegación correcta de wrappers', () => {
  const app = {
    normalizarFecha: compile(appFns.normalizarFecha, { Logic: logic }),
    ds: compile(appFns.ds, { Logic: logic }),
    fmtFecha: compile(appFns.fmtFecha, { Logic: logic }),
  };

  it('ds() delega igual que logic.js', () => {
    expect(app.ds(2026, 5, 1)).toBe(logic.ds(2026, 5, 1));
    expect(app.ds(2026, 0, 5)).toBe(logic.ds(2026, 0, 5));
  });

  it('normalizarFecha() delega igual que logic.js', () => {
    const casos = [
      '', null, undefined, 0,
      '2026-06-15', ' 2026-01-02  ',
      new Date(2026, 5, 15), '2026-06-15T12:00:00',
      '2026-6-5', '2026-13-45', 'invalida',
    ];
    for (const c of casos) {
      expect(app.normalizarFecha(c)).toBe(logic.normalizarFecha(c));
    }
  });

  it('fmtFecha() delega igual que logic.js', () => {
    const casos = ['2026-06-15', '', '2026', null];
    for (const c of casos) {
      expect(app.fmtFecha(c)).toBe(logic.fmtFecha(c));
    }
  });

  it('nombreCabaña() pasa cabañasConfig en cada llamada', () => {
    const config = [{ id: 3, nombre: 'Piedra Grande' }];
    const appFn = compile(appFns.nombreCabaña, { Logic: logic, cabañasConfig: config });
    expect(appFn(3)).toBe(logic.nombreCabaña(config, 3));
    expect(appFn(99)).toBe(logic.nombreCabaña(config, 99));
  });

  it('tarifaCabaña() pasa cabañasConfig en cada llamada', () => {
    const config = [{ id: 1, nombre: 'Cabaña 1', tarifa: 45000 }];
    const appFn = compile(appFns.tarifaCabaña, { Logic: logic, cabañasConfig: config });
    expect(appFn('Cabaña 1')).toBe(logic.tarifaCabaña(config, 'Cabaña 1'));
    expect(appFn('No existe')).toBe(logic.tarifaCabaña(config, 'No existe'));
  });

  it('getReservaEn() pasa reservas en cada llamada', () => {
    const reservas = [
      makeReserva({ ID: 1, Cabaña: 'Cabaña 1', Entrada: '2026-06-10', Salida: '2026-06-13' }),
      makeReserva({ ID: 2, Cabaña: 'Cabaña 1', Entrada: '2026-06-20', Salida: '2026-06-25' }),
      makeReserva({ ID: 3, Cabaña: 'Cabaña 2', Entrada: '2026-06-10', Salida: '2026-06-15' }),
    ];
    const appFn = compile(appFns.getReservaEn, { Logic: logic, reservas });
    const casos = [
      ['Cabaña 1', '2026-06-10'],  // entrada exacta → R1
      ['Cabaña 1', '2026-06-12'],  // dentro del rango → R1
      ['Cabaña 1', '2026-06-13'],  // == Salida (límite) → R1
      ['Cabaña 1', '2026-06-18'],  // hueco entre reservas → undefined
      ['Cabaña 1', '2026-06-20'],  // entrada exacta de la 2da → R2
      ['Cabaña 2', '2026-06-14'],  // rango en cabaña 2 → R3
      ['Cabaña 3', '2026-06-10'],  // cabaña sin reservas → undefined
    ];
    for (const [cab, dStr] of casos) {
      expect(appFn(cab, dStr)).toEqual(logic.getReservaEn(reservas, cab, dStr));
    }
  });

  it('lee el global en cada llamada (no captura valor viejo)', () => {
    const appFn = compile(appFns.nombreCabaña, { Logic: logic, cabañasConfig: [] });
    expect(appFn(1)).toBe('Cabaña 1');
    // El wrapper debe leer la variable en tiempo de llamada:
    // compilamos de nuevo con otra config y debe reflejarla.
    const otra = compile(appFns.nombreCabaña, { Logic: logic, cabañasConfig: [{ id: 1, nombre: 'La Soñada' }] });
    expect(otra(1)).toBe('La Soñada');
  });
});

// ── 3. logic.js sigue exponiendo la API completa ───────────
describe('unificación: API de logic.js intacta', () => {
  it('exporta las funciones unificadas', () => {
    for (const name of WRAPPED_FNS) {
      expect(typeof logic[name]).toBe('function');
    }
    expect(Array.isArray(logic.MESES)).toBe(true);
    expect(logic.MESES[0]).toBe('Enero');
  });

  it('sigue exportando el resto de la API', () => {
    for (const name of ['crearConfigDefault', 'detectarConflictos', 'calcularStats', 'calcularFinanzas']) {
      expect(typeof logic[name]).toBe('function');
    }
  });
});
