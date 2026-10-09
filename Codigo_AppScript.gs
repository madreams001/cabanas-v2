// ============================================================
//  CABAÑAS V2 - SISTEMA DE RESERVAS (backend GAS)
//  Versión 5.0 — Modelo de seguridad V2
//
//  SECRETOS (ScriptProperties, NUNCA en código ni repo):
//    SHEET_ID      — ID del spreadsheet V2
//    WRITE_TOKEN   — token de escritura (solo body POST, rotar tras cutover)
//    ADMIN_EMAILS  — emails admin separados por coma
//    SOCIO_EMAILS  — JSON {"email":"Socio",...} para derivar socio server-side
//
//  AUTH:
//    GET  — sin token. Solo lectura pública mínima (proyección + agregados).
//    POST — requiere body.token === WRITE_TOKEN. El socio se deriva del
//           email Google (Session.getActiveUser().getEmail()); si no hay
//           match, la operación de escritura se rechaza (solo-lectura).
//    config / mantenimiento — además requieren email en ADMIN_EMAILS.
// ============================================================
var SHEET_NAME = 'Reservas';
var CONFIG_SHEET_NAME = 'Config';
var CACHE_TTL_SEG = 300;
var CACHE_KEY = 'v2_reservas_config';
var COLS = [
  'ID', 'Cabaña', 'Tipo', 'Estado', 'Nombre', 'DNI_CUIT',
  'Telefono', 'Email', 'Direccion', 'Entrada', 'Salida',
  'Noches', 'Pago', 'Monto', 'Observaciones', 'Socio',
  'Cargada', 'NotaInterna'
];
var CONFIG_COLS = ['id', 'nombre', 'tarifa', 'capacidad', 'descripcion'];
var SOCIOS_VALIDOS = ['Adriana', 'Federico', 'Jose'];
// Índices cacheados para evitar COLS.indexOf() en cada iteración
var IDX = {};
COLS.forEach(function (col, i) { IDX[col] = i; });

function props_() {
  return PropertiesService.getScriptProperties();
}
function sheetId_() {
  var id = props_().getProperty('SHEET_ID');
  if (!id) throw new Error('config faltante');
  return id;
}
function buildResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
// Respuesta de error genérica: detalle solo en logs (Stackdriver).
function errorGenerico_(detalle) {
  console.error(detalle);
  return buildResponse({ ok: false, error: 'Error interno. Intentá de nuevo.' });
}
function callerEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (e) {
    return '';
  }
}
function adminEmails_() {
  var raw = props_().getProperty('ADMIN_EMAILS') || '';
  return raw.split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(function (s) { return !!s; });
}
function isAdmin_(email) {
  return adminEmails_().indexOf((email || '').toLowerCase()) !== -1;
}
function socioDeEmail_(email) {
  try {
    var raw = props_().getProperty('SOCIO_EMAILS') || '{}';
    var mapa = JSON.parse(raw);
    return mapa[(email || '').toLowerCase()] || '';
  } catch (e) {
    return '';
  }
}
// ── GET: lectura pública mínima, SIN token ────────────────────
// Devuelve proyección mínima (sin PII, sin NotaInterna salvo admin),
// agregados de finanzas calculados en servidor, y config de cabañas.
// Todo cacheado 300s como {reservas, config}.
function doGet(e) {
  try {
    var email = callerEmail_();
    var admin = isAdmin_(email);
    var ss = SpreadsheetApp.openById(sheetId_());
    var sheet = getOrCreateSheet(ss);
    verificarConfiguracion(ss);
    var prop = props_();
    var enMantenimiento = prop.getProperty('mantenimiento_activo') === 'true';
    if (enMantenimiento && !admin) {
      return buildResponse({ ok: true, mantenimiento: true, reservas: [], isAdmin: false });
    }
    var cache = CacheService.getScriptCache();
    var cached = cache.get(CACHE_KEY);
    if (cached) {
      var data = JSON.parse(cached);
      return buildResponse({
        ok: true, mantenimiento: false,
        reservas: proyectar_(data.reservas, admin),
        finanzas: data.finanzas,
        config: data.config, cached: true, isAdmin: admin
      });
    }
    var rows = sheet.getDataRange().getValues();
    var completas = filasAObjetos_(rows);
    var finanzas = calcularFinanzas_(completas);
    var config = leerConfig(ss);
    cache.put(CACHE_KEY, JSON.stringify({ reservas: completas, finanzas: finanzas, config: config }), CACHE_TTL_SEG);
    return buildResponse({
      ok: true, mantenimiento: false,
      reservas: proyectar_(completas, admin),
      finanzas: finanzas, config: config, isAdmin: admin
    });
  } catch (err) {
    return errorGenerico_('doGet: ' + err.message);
  }
}
// Proyección mínima: id, cabaña, fechas, estado, tipo, socio, noches.
// PII (DNI/tel/email/dirección/monto/observaciones) NO viaja.
// NotaInterna solo si el caller es admin (server-side).
function proyectar_(completas, esAdmin) {
  return completas.map(function (r) {
    var p = {
      ID: r.ID, 'Cabaña': r['Cabaña'], Tipo: r.Tipo, Estado: r.Estado,
      Entrada: r.Entrada, Salida: r.Salida, Noches: r.Noches,
      Socio: r.Socio, Cargada: r.Cargada
    };
    if (esAdmin) p.NotaInterna = r.NotaInterna || '';
    return p;
  });
}
function filasAObjetos_(rows) {
  if (rows.length <= 1) return [];
  return rows.slice(1)
    .filter(function (row) { return row[0] !== '' && row[0] !== null; })
    .map(function (row) {
      var obj = {};
      COLS.forEach(function (col, i) {
        var val = row[i];
        if (val instanceof Date) {
          var y = val.getFullYear();
          var m = String(val.getMonth() + 1).padStart(2, '0');
          var d = String(val.getDate()).padStart(2, '0');
          val = y + '-' + m + '-' + d;
        }
        obj[col] = (val || '').toString();
      });
      return obj;
    });
}
// Agregados de finanzas en servidor: el monto individual nunca viaja.
function calcularFinanzas_(completas) {
  var porMes = {}, porCabana = {}, porSocio = {}, total = 0;
  completas.forEach(function (r) {
    var monto = Number(r.Monto) || 0;
    total += monto;
    var mes = (r.Entrada || '').substring(0, 7);
    var cab = r['Cabaña'] || '—';
    var soc = r.Socio || '—';
    if (!porMes[mes]) porMes[mes] = { total: 0, count: 0 };
    if (!porCabana[cab]) porCabana[cab] = { total: 0, count: 0 };
    if (!porSocio[soc]) porSocio[soc] = { total: 0, count: 0 };
    porMes[mes].total += monto; porMes[mes].count++;
    porCabana[cab].total += monto; porCabana[cab].count++;
    porSocio[soc].total += monto; porSocio[soc].count++;
  });
  return { porMes: porMes, porCabana: porCabana, porSocio: porSocio, total: total };
}
function invalidarCache_() {
  CacheService.getScriptCache().remove(CACHE_KEY);
}
// ── POST: escritura, token SOLO en body ───────────────────────
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var writeToken = props_().getProperty('WRITE_TOKEN');
    if (!writeToken || payload.token !== writeToken) {
      return buildResponse({ ok: false, error: 'Acceso no autorizado' });
    }
    var email = callerEmail_();
    var admin = isAdmin_(email);
    // Acción de mantenimiento global: solo admins (server-side).
    if (payload.action === 'mantenimiento') {
      if (!admin) return buildResponse({ ok: false, error: 'Acceso no autorizado' });
      var p = props_();
      if (payload.estado === true) {
        p.setProperty('mantenimiento_activo', 'true');
        invalidarCache_();
        return buildResponse({ ok: true, mensaje: 'Mantenimiento activado globalmente' });
      }
      p.deleteProperty('mantenimiento_activo');
      invalidarCache_();
      return buildResponse({ ok: true, mensaje: 'Mantenimiento desactivado' });
    }
    // Acción de config: solo admins (server-side).
    if (payload.action === 'config') {
      if (!admin) return buildResponse({ ok: false, error: 'Acceso no autorizado' });
      var ss0 = SpreadsheetApp.openById(sheetId_());
      verificarConfiguracion(ss0);
      return guardarConfigSheet(ss0, payload.config);
    }
    // Crear / editar / eliminar: socio derivado del email Google.
    var socio = socioDeEmail_(email);
    if (!socio || SOCIOS_VALIDOS.indexOf(socio) === -1) {
      return buildResponse({ ok: false, error: 'Tu cuenta no está habilitada para escribir.' });
    }
    var ss = SpreadsheetApp.openById(sheetId_());
    var sheet = getOrCreateSheet(ss);
    verificarConfiguracion(ss);
    if (payload.action === 'crear')    return crearReserva(sheet, payload.reserva, socio);
    if (payload.action === 'editar')   return editarReserva(sheet, payload.id, payload.reserva, socio);
    if (payload.action === 'eliminar') return eliminarReserva(sheet, payload.id, socio, admin);
    return buildResponse({ ok: false, error: 'Accion desconocida' });
  } catch (err) {
    return errorGenerico_('doPost: ' + err.message);
  }
}
// ── Verificar configuración (solo primera vez) ──────────────
function verificarConfiguracion(ss) {
  var p = props_();
  if (p.getProperty('setup_done') === 'true') return;
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) {
    repararEncabezados(sheet);
    setColumnWidths(sheet);
    p.setProperty('setup_done', 'true');
  }
}
// ─ PUNTO 1: Crear reserva con LockService ───────────────────
function crearReserva(sheet, r, socio) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return buildResponse({ ok: false, error: 'Servidor ocupado. Intentá de nuevo.' });
  }
  try {
    // Validar campos obligatorios
    if (!r.cabaña || !r.entrada || !r.salida || !r.nombre || !r.estado) {
      return buildResponse({ ok: false, error: 'Faltan campos obligatorios.' });
    }
    var rows = sheet.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row[0]) continue;
      var cab = row[IDX['Cabaña']];
      var ent = (row[IDX['Entrada']] || '').toString();
      var sal = (row[IDX['Salida']]  || '').toString();
      if (cab === r.cabaña && r.entrada < sal && r.salida > ent && r.entrada !== sal) {
        return buildResponse({ ok: false, conflicto: true, error: 'Conflicto de fechas en esa cabaña.' });
      }
    }
    var noches     = Math.round((new Date(r.salida) - new Date(r.entrada)) / 86400000);
    var id         = Date.now().toString();
    var cargada    = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba' });
    var entradaStr = r.entrada.substring(0, 10);
    var salidaStr  = r.salida.substring(0, 10);
    var newRow = [
      id, r.cabaña, r.tipo, r.estado, r.nombre, r.dni,
      r.tel || '', r.email || '', r.dir || '',
      entradaStr, salidaStr, noches,
      r.pago || '', r.monto || '', r.obs || '',
      socio, cargada, r.notaInterna || ''
    ];
    sheet.appendRow(newRow);
    // NOTA V2: sin aplicarEstilosFila en el path crítico (7 llamadas por
    // escritura). Usar formato condicional en el Sheet por columna Estado.
    invalidarCache_();
    return buildResponse({ ok: true, id: id, noches: noches, cargada: cargada });
  } catch (err) {
    return errorGenerico_('crearReserva: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}
// ── PUNTO 2: Editar reserva in-situ (no destructiva) ─────────
function editarReserva(sheet, id, r, socio) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return buildResponse({ ok: false, error: 'Servidor ocupado. Intentá de nuevo.' });
  }
  try {
    // Validar campos obligatorios
    if (!r.cabaña || !r.entrada || !r.salida || !r.nombre || !r.estado) {
      return buildResponse({ ok: false, error: 'Faltan campos obligatorios.' });
    }
    var rows = sheet.getDataRange().getValues();
    var rowIndex = -1;
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0].toString() === id.toString()) {
        rowIndex = i + 1;
        break;
      }
    }
    if (rowIndex === -1) {
      return buildResponse({ ok: false, error: 'Reserva no encontrada.' });
    }
    // Solo el socio dueño edita (el admin también puede).
    var dueno = (rows[rowIndex - 1][IDX['Socio']] || '').toString();
    var email = callerEmail_();
    if (dueno !== socio && !isAdmin_(email)) {
      return buildResponse({ ok: false, error: 'Acceso no autorizado' });
    }
    for (var j = 1; j < rows.length; j++) {
      if (j + 1 === rowIndex) continue;
      var row = rows[j];
      if (!row[0]) continue;
      var cab = row[IDX['Cabaña']];
      var ent = (row[IDX['Entrada']] || '').toString();
      var sal = (row[IDX['Salida']]  || '').toString();
      if (cab === r.cabaña && r.entrada < sal && r.salida > ent && r.entrada !== sal) {
        return buildResponse({ ok: false, conflicto: true, error: 'Conflicto de fechas en esa cabaña.' });
      }
    }
    var noches     = Math.round((new Date(r.salida) - new Date(r.entrada)) / 86400000);
    var entradaStr = r.entrada.substring(0, 10);
    var salidaStr  = r.salida.substring(0, 10);
    var cargadaOriginal = (rows[rowIndex - 1][IDX['Cargada']] || '').toString();
    var updatedRow = [
      id, r.cabaña, r.tipo, r.estado, r.nombre, r.dni,
      r.tel || '', r.email || '', r.dir || '',
      entradaStr, salidaStr, noches,
      r.pago || '', r.monto || '', r.obs || '',
      socio, cargadaOriginal, r.notaInterna || ''
    ];
    // CORRECCIÓN: matriz 2D explícita con rango exacto
    var range = sheet.getRange(rowIndex, 1, 1, COLS.length);
    range.setValues([updatedRow]);
    // NOTA V2: sin aplicarEstilosFila en el path crítico (ver crearReserva).
    invalidarCache_();
    return buildResponse({ ok: true, id: id, noches: noches, cargada: cargadaOriginal });
  } catch (err) {
    return errorGenerico_('editarReserva: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}
// ── Eliminar reserva (con LockService) ───────────────────────
function eliminarReserva(sheet, id, socio, esAdmin) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (e) {
    return buildResponse({ ok: false, error: 'Servidor ocupado. Intentá de nuevo.' });
  }
  try {
    var rows = sheet.getDataRange().getValues();
    for (var i = rows.length - 1; i >= 1; i--) {
      if (rows[i][0].toString() === id.toString()) {
        var dueno = (rows[i][IDX['Socio']] || '').toString();
        if (dueno !== socio && !esAdmin) {
          return buildResponse({ ok: false, error: 'Acceso no autorizado' });
        }
        sheet.deleteRow(i + 1);
        invalidarCache_();
        return buildResponse({ ok: true });
      }
    }
    return buildResponse({ ok: false, error: 'Reserva no encontrada.' });
  } catch (err) {
    return errorGenerico_('eliminarReserva: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}
// ─ Aplicar estilos de color por estado ──────────────────────
// V2: conservada solo para uso manual / backfill. NO se llama en el
// path crítico de escritura; usar formato condicional en el Sheet:
//   Estado = Ocupada       → fondo #b80000, texto blanco
//   Estado = Confirmada    → fondo #FF8C00, texto blanco
//   Estado = No confirmada → fondo #FAD201, texto #5a4300
function aplicarEstilosFila(sheet, rowIndex, estado, columnsCount) {
  var rowRange = sheet.getRange(rowIndex, 1, 1, columnsCount);
  rowRange.setVerticalAlignment('middle');
  var dateCols = [IDX['Entrada'] + 1, IDX['Salida'] + 1];
  dateCols.forEach(function (col) { sheet.getRange(rowIndex, col).setNumberFormat('@STRING@'); });
  var bg = '#ffffff';
  if      (estado === 'Ocupada')       bg = '#fce8e6';
  else if (estado === 'Confirmada')    bg = '#fef7e0';
  else if (estado === 'No confirmada') bg = '#fffde7';
  var bgs = [Array(columnsCount).fill(bg)];
  rowRange.setBackgrounds(bgs);
  var ec = sheet.getRange(rowIndex, IDX['Estado'] + 1);
  if      (estado === 'Ocupada')       { ec.setBackground('#b80000'); ec.setFontColor('#ffffff'); }
  else if (estado === 'Confirmada')    { ec.setBackground('#FF8C00'); ec.setFontColor('#ffffff'); }
  else if (estado === 'No confirmada') { ec.setBackground('#FAD201'); ec.setFontColor('#5a4300'); }
  ec.setFontWeight('bold');
}
// ── Reparar encabezados si faltan ─────────────────────────────
function repararEncabezados(sheet) {
  var primera = sheet.getRange(1, 1).getValue().toString();
  if (primera !== 'ID') {
    sheet.insertRowBefore(1);
    var hr = sheet.getRange(1, 1, 1, COLS.length);
    hr.setValues([COLS]);
    hr.setBackground('#1a73e8');
    hr.setFontColor('#ffffff');
    hr.setFontWeight('bold');
    hr.setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    setColumnWidths(sheet);
  }
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('NotaInterna') === -1) {
    var nextCol = lastCol + 1;
    var cell = sheet.getRange(1, nextCol);
    cell.setValue('NotaInterna');
    cell.setBackground('#1a73e8');
    cell.setFontColor('#ffffff');
    cell.setFontWeight('bold');
    sheet.setColumnWidth(nextCol, 200);
  }
}
// ── Crear hoja si no existe ───────────────────────────────────
function getOrCreateSheet(ss) {
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    var hr = sheet.getRange(1, 1, 1, COLS.length);
    hr.setValues([COLS]);
    hr.setBackground('#1a73e8');
    hr.setFontColor('#ffffff');
    hr.setFontWeight('bold');
    hr.setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    setColumnWidths(sheet);
  }
  return sheet;
}
// ── Anchos de columna ────────────────────────────────────────
function setColumnWidths(sheet) {
  [130, 100, 100, 150, 180, 120, 130, 180, 200, 100, 100, 70, 130, 100, 200, 100, 160, 200]
    .forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
}

// ── Incluir archivos HTML separados (patrón GAS include) ────
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ═══════════════════════════════════════════════════════════
//  CONFIGURACIÓN DE CABAÑAS (hoja "Config")
// ═══════════════════════════════════════════════════════════

function getOrCreateConfigSheet(ss) {
  var sheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG_SHEET_NAME);
    var hr = sheet.getRange(1, 1, 1, CONFIG_COLS.length);
    hr.setValues([CONFIG_COLS]);
    hr.setBackground('#1a73e8');
    hr.setFontColor('#ffffff');
    hr.setFontWeight('bold');
    hr.setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
    // Crear config por defecto para 8 cabañas
    var defaultRows = [];
    for (var i = 1; i <= 8; i++) {
      defaultRows.push([i.toString(), 'Cabaña ' + i, 0, 0, '']);
    }
    if (defaultRows.length > 0) {
      sheet.getRange(2, 1, defaultRows.length, CONFIG_COLS.length).setValues(defaultRows);
    }
  }
  return sheet;
}

function leerConfig(ss) {
  try {
    var sheet = getOrCreateConfigSheet(ss);
    var rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return [];
    return rows.slice(1)
      .filter(function (row) { return row[0] !== '' && row[0] !== null; })
      .map(function (row) {
        var obj = {};
        CONFIG_COLS.forEach(function (col, i) {
          obj[col] = (row[i] || '').toString();
        });
        return obj;
      });
  } catch (e) {
    return [];
  }
}

function guardarConfigSheet(ss, config) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return buildResponse({ ok: false, error: 'Servidor ocupado. Intentá de nuevo.' });
  }
  try {
    var sheet = getOrCreateConfigSheet(ss);
    // Borrar todo excepto encabezados
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, CONFIG_COLS.length).clearContent();
    }
    // Escribir nueva config
    if (config && config.length > 0) {
      var rows = config.map(function (c) {
        return [
          c.id.toString(),
          c.nombre || '',
          Number(c.tarifa) || 0,
          Number(c.capacidad) || 0,
          c.descripcion || ''
        ];
      });
      sheet.getRange(2, 1, rows.length, CONFIG_COLS.length).setValues(rows);
    }
    invalidarCache_();
    return buildResponse({ ok: true, mensaje: 'Configuración guardada' });
  } catch (err) {
    return errorGenerico_('guardarConfigSheet: ' + err.message);
  } finally {
    lock.releaseLock();
  }
}
