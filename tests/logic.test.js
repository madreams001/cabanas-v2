const {
  MESES, ds, normalizarFecha, fmtFecha,
  nombreCabaña, tarifaCabaña, crearConfigDefault,
  detectarConflictos, getReservaEn,
  calcularStats, calcularFinanzas, obtenerAlertasProximas,
  calcularCalendario, filtrarReservas, ordenarReservas,
  agruparPorMes, exportCSVData,
} = require('../src/logic');

// ── Helpers ────────────────────────────────────────────────
const defaultConfig = crearConfigDefault();
const makeReserva = (overrides) => ({
  ID: 1, Cabaña: 'Cabaña 1', Tipo: 'Particular', Estado: 'Confirmada',
  Nombre: 'Juan Pérez', DNI_CUIT: '12345678', Telefono: '', Email: '',
  Direccion: '', Entrada: '2026-06-10', Salida: '2026-06-13',
  Noches: 3, Pago: '', Monto: 30000, Observaciones: '',
  NotaInterna: '', Socio: 'Cromi', Cargada: '22/5/2026 16:00:00',
  ...overrides,
});

// ── ds ─────────────────────────────────────────────────────
describe('ds()', () => {
  it('formatea año/mes/día a YYYY-MM-DD', () => {
    expect(ds(2026, 5, 1)).toBe('2026-06-01');
  });
  it('agrega padding a mes y día', () => {
    expect(ds(2026, 0, 5)).toBe('2026-01-05');
    expect(ds(2026, 11, 31)).toBe('2026-12-31');
  });
});

// ── normalizarFecha ────────────────────────────────────────
describe('normalizarFecha()', () => {
  it('devuelve vacío si no hay valor', () => {
    expect(normalizarFecha('')).toBe('');
    expect(normalizarFecha(null)).toBe('');
    expect(normalizarFecha(undefined)).toBe('');
  });
  it('no modifica YYYY-MM-DD válido', () => {
    expect(normalizarFecha('2026-06-15')).toBe('2026-06-15');
  });
  it('convierte Date a YYYY-MM-DD', () => {
    expect(normalizarFecha(new Date(2026, 5, 15))).toBe('2026-06-15');
  });
  it('convierte ISO string a YYYY-MM-DD', () => {
    expect(normalizarFecha('2026-06-15T12:00:00')).toBe('2026-06-15');
  });
  it('devuelve el string original si no se puede parsear', () => {
    expect(normalizarFecha('invalida')).toBe('invalida');
  });
});

// ── fmtFecha ───────────────────────────────────────────────
describe('fmtFecha()', () => {
  it('convierte YYYY-MM-DD a DD-MM-YYYY', () => {
    expect(fmtFecha('2026-06-15')).toBe('15-06-2026');
  });
  it('devuelve — si no hay fecha', () => {
    expect(fmtFecha('')).toBe('—');
    expect(fmtFecha(null)).toBe('—');
  });
  it('trunca strings más largos', () => {
    expect(fmtFecha('2026-06-15T12:00:00')).toBe('15-06-2026');
  });
});

// ── nombreCabaña ───────────────────────────────────────────
describe('nombreCabaña()', () => {
  it('devuelve el nombre desde la config', () => {
    expect(nombreCabaña(defaultConfig, 1)).toBe('Cabaña 1');
  });
  it('devuelve fallback si el ID no existe', () => {
    expect(nombreCabaña(defaultConfig, 99)).toBe('Cabaña 99');
  });
  it('devuelve nombre personalizado', () => {
    const cfg = [{ id: 1, nombre: 'Los Álamos', tarifa: 10000 }];
    expect(nombreCabaña(cfg, 1)).toBe('Los Álamos');
  });
});

// ── tarifaCabaña ───────────────────────────────────────────
describe('tarifaCabaña()', () => {
  it('devuelve la tarifa desde la config', () => {
    const cfg = [{ id: 1, nombre: 'Los Álamos', tarifa: 12000 }];
    expect(tarifaCabaña(cfg, 'Los Álamos')).toBe(12000);
  });
  it('devuelve 0 si no encuentra la cabaña', () => {
    expect(tarifaCabaña(defaultConfig, 'Inexistente')).toBe(0);
  });
});

// ── crearConfigDefault ─────────────────────────────────────
describe('crearConfigDefault()', () => {
  it('crea 8 cabañas', () => {
    expect(crearConfigDefault()).toHaveLength(8);
  });
  it('cada cabaña tiene id, nombre, tarifa, capacidad, descripcion', () => {
    const cfg = crearConfigDefault();
    cfg.forEach((c, i) => {
      expect(c.id).toBe(i + 1);
      expect(c.nombre).toBe('Cabaña ' + (i + 1));
      expect(c.tarifa).toBe(0);
      expect(c.capacidad).toBe(0);
      expect(c.descripcion).toBe('');
    });
  });
});

// ── detectarConflictos ─────────────────────────────────────
describe('detectarConflictos()', () => {
  const reservas = [
    makeReserva({ ID: 1, Cabaña: 'Cabaña 1', Entrada: '2026-06-10', Salida: '2026-06-13' }),
    makeReserva({ ID: 2, Cabaña: 'Cabaña 1', Entrada: '2026-06-15', Salida: '2026-06-18' }),
    makeReserva({ ID: 3, Cabaña: 'Cabaña 2', Entrada: '2026-06-10', Salida: '2026-06-13' }),
  ];

  it('detecta conflicto cuando hay solapamiento', () => {
    const result = detectarConflictos(reservas, 'Cabaña 1', '2026-06-11', '2026-06-14', null);
    expect(result).toHaveLength(1);
    expect(result[0].ID).toBe(1);
  });

  it('no detecta conflicto si la reserva termina justo cuando empieza la nueva', () => {
    const result = detectarConflictos(reservas, 'Cabaña 1', '2026-06-13', '2026-06-15', null);
    expect(result).toHaveLength(0);
  });

  it('excluye la reserva por ID correctamente (edición)', () => {
    const result = detectarConflictos(reservas, 'Cabaña 1', '2026-06-11', '2026-06-14', 1);
    expect(result).toHaveLength(0);
  });

  it('no hay conflicto en cabaña diferente', () => {
    const result = detectarConflictos(reservas, 'Cabaña 3', '2026-06-11', '2026-06-14', null);
    expect(result).toHaveLength(0);
  });
});

// ── getReservaEn ───────────────────────────────────────────
describe('getReservaEn()', () => {
  const reservas = [
    makeReserva({ ID: 1, Cabaña: 'Cabaña 1', Entrada: '2026-06-10', Salida: '2026-06-13' }),
  ];

  it('encuentra reserva por fecha de entrada exacta', () => {
    expect(getReservaEn(reservas, 'Cabaña 1', '2026-06-10').ID).toBe(1);
  });

  it('encuentra reserva por rango', () => {
    expect(getReservaEn(reservas, 'Cabaña 1', '2026-06-11').ID).toBe(1);
  });

  it('devuelve undefined si no hay reserva', () => {
    expect(getReservaEn(reservas, 'Cabaña 1', '2026-06-14')).toBeUndefined();
  });
});

// ── calcularStats ──────────────────────────────────────────
describe('calcularStats()', () => {
  const today = '2026-06-01';
  const reservas = [
    makeReserva({ Estado: 'Ocupada', Salida: '2026-06-10', Monto: 15000 }),
    makeReserva({ ID: 2, Estado: 'Confirmada', Salida: '2026-06-15', Monto: 20000 }),
    makeReserva({ ID: 3, Estado: 'No confirmada', Salida: '2026-06-20', Monto: 25000 }),
    makeReserva({ ID: 4, Estado: 'Ocupada', Salida: '2026-05-30', Monto: 10000 }),
  ];

  it('cuenta estadísticas correctamente', () => {
    const s = calcularStats(reservas, today);
    expect(s.ocupadas).toBe(1);
    expect(s.confirmadas).toBe(1);
    expect(s.noConfirmadas).toBe(1);
    expect(s.total).toBe(4);
    expect(s.ingresos).toBe(70000);
  });

  it('reserva pasada no cuenta en estado activo', () => {
    const s = calcularStats(reservas, today);
    expect(s.ocupadas).toBe(1);
  });
});

// ── calcularFinanzas ───────────────────────────────────────
describe('calcularFinanzas()', () => {
  const reservas = [
    makeReserva({ Entrada: '2026-06-10', Monto: 30000, Socio: 'Cromi', Cabaña: 'Cabaña 1' }),
    makeReserva({ ID: 2, Entrada: '2026-06-15', Monto: 20000, Socio: 'Cromi', Cabaña: 'Cabaña 2' }),
    makeReserva({ ID: 3, Entrada: '2026-07-01', Monto: 25000, Socio: 'Adri', Cabaña: 'Cabaña 1' }),
  ];

  it('agrupa por mes', () => {
    const f = calcularFinanzas(reservas);
    expect(f.porMes['2026-06'].total).toBe(50000);
    expect(f.porMes['2026-06'].count).toBe(2);
    expect(f.porMes['2026-07'].total).toBe(25000);
  });

  it('agrupa por cabaña', () => {
    const f = calcularFinanzas(reservas);
    expect(f.porCabaña['Cabaña 1'].total).toBe(55000);
    expect(f.porCabaña['Cabaña 2'].total).toBe(20000);
  });

  it('agrupa por socio', () => {
    const f = calcularFinanzas(reservas);
    expect(f.porSocio['Cromi'].total).toBe(50000);
    expect(f.porSocio['Adri'].total).toBe(25000);
  });

  it('calcula total global', () => {
    expect(calcularFinanzas(reservas).total).toBe(75000);
  });

  it('devuelve ceros con array vacío', () => {
    const f = calcularFinanzas([]);
    expect(f.total).toBe(0);
    expect(Object.keys(f.porMes)).toHaveLength(0);
  });
});

// ── obtenerAlertasProximas ─────────────────────────────────
describe('obtenerAlertasProximas()', () => {
  const reservas = [
    makeReserva({ Entrada: '2026-06-10' }),
    makeReserva({ ID: 2, Entrada: '2026-06-11' }),
    makeReserva({ ID: 3, Entrada: '2026-06-15' }),
  ];

  it('filtra por fechas específicas', () => {
    const r = obtenerAlertasProximas(reservas, ['2026-06-10', '2026-06-11']);
    expect(r).toHaveLength(2);
  });

  it('devuelve vacío si ninguna coincide', () => {
    expect(obtenerAlertasProximas(reservas, ['2026-07-01'])).toHaveLength(0);
  });
});

// ── calcularCalendario ─────────────────────────────────────
describe('calcularCalendario()', () => {
  const reservas = [
    makeReserva({ Cabaña: 'Cabaña 1', Entrada: '2026-06-10', Salida: '2026-06-12' }),
  ];

  it('indexa reservas por cabaña+fecha', () => {
    const { dim, resMap } = calcularCalendario(reservas, defaultConfig, 2026, 5);
    expect(dim).toBe(30);
    expect(Object.keys(resMap).length).toBeGreaterThanOrEqual(3);
    expect(resMap['Cabaña 1|2026-06-10']).toBeDefined();
    expect(resMap['Cabaña 1|2026-06-11']).toBeDefined();
    expect(resMap['Cabaña 1|2026-06-12']).toBeDefined();
  });

  it('no indexa fechas fuera del rango', () => {
    const { resMap } = calcularCalendario(reservas, defaultConfig, 2026, 5);
    expect(resMap['Cabaña 1|2026-06-13']).toBeUndefined();
  });
});

// ── filtrarReservas ────────────────────────────────────────
describe('filtrarReservas()', () => {
  const reservas = [
    makeReserva({ Cabaña: 'Cabaña 1', Estado: 'Confirmada', Tipo: 'Particular', Socio: 'Cromi', Entrada: '2026-06-10', Nombre: 'Juan Pérez', DNI_CUIT: '12345678' }),
    makeReserva({ ID: 2, Cabaña: 'Cabaña 2', Estado: 'Ocupada', Tipo: 'Empresa', Socio: 'Adri', Entrada: '2026-07-01', Salida: '2026-07-03', Nombre: 'María López', DNI_CUIT: '87654321' }),
  ];

  it('filtra por cabaña', () => {
    expect(filtrarReservas(reservas, { cab: 'Cabaña 1' })).toHaveLength(1);
  });
  it('filtra por estado', () => {
    expect(filtrarReservas(reservas, { estado: 'Ocupada' })).toHaveLength(1);
  });
  it('filtra por tipo', () => {
    expect(filtrarReservas(reservas, { tipo: 'Empresa' })).toHaveLength(1);
  });
  it('filtra por socio', () => {
    expect(filtrarReservas(reservas, { socio: 'Cromi' })).toHaveLength(1);
  });
  it('filtra por mes', () => {
    expect(filtrarReservas(reservas, { mes: '2026-06' })).toHaveLength(1);
  });
  it('filtra por búsqueda (nombre)', () => {
    expect(filtrarReservas(reservas, { buscar: 'maría' })).toHaveLength(1);
  });
  it('filtra por búsqueda (DNI)', () => {
    expect(filtrarReservas(reservas, { buscar: '8765' })).toHaveLength(1);
  });
  it('combina filtros', () => {
    expect(filtrarReservas(reservas, { cab: 'Cabaña 1', estado: 'Confirmada' })).toHaveLength(1);
  });
  it('devuelve todo si no hay filtros', () => {
    expect(filtrarReservas(reservas, {})).toHaveLength(2);
  });
  it('devuelve vacío si ningún filtro coincide', () => {
    expect(filtrarReservas(reservas, { mes: '2025-01' })).toHaveLength(0);
  });
});

// ── ordenarReservas ────────────────────────────────────────
describe('ordenarReservas()', () => {
  const reservas = [
    makeReserva({ ID: 1, Cabaña: 'Cabaña 2', Entrada: '2026-06-15', Nombre: 'Zulema', Socio: 'Adri' }),
    makeReserva({ ID: 2, Cabaña: 'Cabaña 1', Entrada: '2026-06-10', Nombre: 'Ana', Socio: 'Cromi' }),
    makeReserva({ ID: 3, Cabaña: 'Cabaña 1', Entrada: '2026-06-12', Nombre: 'Beatriz', Socio: 'Cromi' }),
  ];

  it('default: ordena por cabaña luego fecha', () => {
    const r = ordenarReservas(reservas, '');
    expect(r[0].ID).toBe(2); // C1, 10-jun
    expect(r[1].ID).toBe(3); // C1, 12-jun
    expect(r[2].ID).toBe(1); // C2
  });

  it('orden por nombre ascendente', () => {
    const r = ordenarReservas(reservas, 'nombre-asc');
    expect(r[0].Nombre).toBe('Ana');
    expect(r[2].Nombre).toBe('Zulema');
  });

  it('orden por fecha descendente', () => {
    const r = ordenarReservas(reservas, 'fecha-desc');
    expect(r[0].ID).toBe(1);
    expect(r[2].ID).toBe(2);
  });

  it('orden por socio ascendente', () => {
    const r = ordenarReservas(reservas, 'socio-asc');
    expect(r[0].Socio).toBe('Adri');
    expect(r[2].Socio).toBe('Cromi');
  });
});

// ── agruparPorMes ──────────────────────────────────────────
describe('agruparPorMes()', () => {
  const reservas = [
    makeReserva({ Entrada: '2026-06-10' }),
    makeReserva({ ID: 2, Entrada: '2026-06-15' }),
    makeReserva({ ID: 3, Entrada: '2026-07-01' }),
  ];

  it('agrupa correctamente por mes', () => {
    const g = agruparPorMes(reservas);
    expect(Object.keys(g)).toEqual(['2026-06', '2026-07']);
    expect(g['2026-06']).toHaveLength(2);
    expect(g['2026-07']).toHaveLength(1);
  });

  it('devuelve objeto vacío si no hay reservas', () => {
    expect(agruparPorMes([])).toEqual({});
  });
});

// ── exportCSVData ──────────────────────────────────────────
describe('exportCSVData()', () => {
  const reservas = [
    makeReserva({ Nombre: 'Juan "El" Pérez', Monto: 30000 }),
  ];

  it('genera CSV con header y datos', () => {
    const csv = exportCSVData(reservas);
    expect(csv).toContain('Cabaña,Tipo,Estado,Nombre');
    expect(csv).toContain('Cabaña 1');
    expect(csv).toContain('Juan');
  });

  it('escapa comillas dobles', () => {
    const csv = exportCSVData(reservas);
    expect(csv).toContain('"Juan ""El"" Pérez"');
  });

  it('devuelve string vacío si no hay reservas', () => {
    expect(exportCSVData([])).toBe('');
  });
});
