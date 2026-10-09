// ═══════════════════════════════════════════════════════════
//  ESTADO GLOBAL — V2
//  API_URL y WRITE_TOKEN vienen de window.APP_CONFIG, inyectado por
//  build.js desde config.local.json (gitignoreado). Nunca commitear.
// ═══════════════════════════════════════════════════════════
// V2-FIX#5 (Stored XSS): escape HTML en TODA interpolación de datos.
function esc(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const API_URL = (window.APP_CONFIG && window.APP_CONFIG.apiUrl) || '';
const WRITE_TOKEN = (window.APP_CONFIG && window.APP_CONFIG.writeToken) || '';
let reservas = [];
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let usuarioActual = '';
let vistaListado = 'lista';
const IS_CONFIGURED = API_URL !== 'PEGAR_AQUI_LA_URL_DE_APPS_SCRIPT';
let formularioActivo = false;
let adminSession = localStorage.getItem('admin_session') === 'true';
let identidadSeleccionada = false;

// ── Configuración de cabañas (nombres y tarifas) ──────────────
const CONFIG_KEY = 'cabanas_config_v1';
let cabañasConfig = cargarConfigCabañas();

function cargarConfigCabañas() {
  const saved = localStorage.getItem(CONFIG_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch(e) {}
  }
  return Array.from({length:8}, (_,i) => ({
    id:     i+1,
    nombre: 'Cabaña ' + (i+1),
    tarifa: 0,
    capacidad: 0,
    descripcion: ''
  }));
}

function guardarConfigCabañas() {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cabañasConfig)); } catch(e) {}
}

function nombreCabaña(n) {
  return Logic.nombreCabaña(cabañasConfig, n);
}

function tarifaCabaña(nombreBuscado) {
  return Logic.tarifaCabaña(cabañasConfig, nombreBuscado);
}

function setVista(v) {
  vistaListado = v;
  document.getElementById('btnVistaGrid').classList.toggle('activo', v === 'grid');
  document.getElementById('btnVistaLista').classList.toggle('activo', v === 'lista');
  renderListado();
}

function actualizarSelectoresCabaña() {
  const opcionesFiltro = ['<option value="">Todas las cabañas</option>'];
  const opcionesForm   = ['<option value="">— elegir —</option>'];
  cabañasConfig.forEach(c => {
    opcionesFiltro.push(`<option value="${esc(c.nombre)}">${esc(c.nombre)}</option>`);
    opcionesForm.push(`<option value="${esc(c.nombre)}">${esc(c.nombre)}</option>`);
  });
  const fCabaña = document.getElementById('fCabaña');
  if (fCabaña) fCabaña.innerHTML = opcionesForm.join('');
  const filtCabaña = document.getElementById('filtCabaña');
  if (filtCabaña) filtCabaña.innerHTML = opcionesFiltro.join('');
  // NOTA V2: las opciones se construyen solo desde cabañasConfig (no PII).
  // renderCard y demás usan esc() para datos de reservas.
}

// ═══════════════════════════════════════════════════════════
//  IDENTIDAD
// ═══════════════════════════════════════════════════════════
function setIdentidad(nombre) {
  usuarioActual = nombre;
  identidadSeleccionada = true;
  sessionStorage.setItem('usuario_actual', nombre);
  
  const modal = document.getElementById('idModal');
  modal.style.display = 'none';
  modal.style.pointerEvents = 'none';
  modal.style.visibility = 'hidden';
  
  document.getElementById('headerUsuario').textContent = '👤 ' + nombre;
  document.getElementById('fSocio').value = nombre;
  const disp = document.getElementById('socioDisplay');
  if (disp) disp.textContent = '👤 ' + nombre;
  renderListado();
}

function iniciarIdentidad() {
  // Ocultar popup de conexión cuando aparece la selección de identidad
  document.getElementById('connectionBanner').style.display = 'none';
  
  if (identidadSeleccionada || usuarioActual) {
    const modal = document.getElementById('idModal');
    modal.style.display = 'none';
    modal.style.pointerEvents = 'none';
    modal.style.visibility = 'hidden';
    return;
  }
  document.getElementById('idModal').style.display = 'flex';
  document.getElementById('idModal').style.pointerEvents = 'auto';
  document.getElementById('idModal').style.visibility = 'visible';
}

function cambiarIdentidad(nombre) {
  // Deshabilitada — no se puede cambiar el usuario una vez elegido
}

window.addEventListener('beforeunload', () => {
  usuarioActual = '';
  identidadSeleccionada = false;
  sessionStorage.removeItem('usuario_actual');
});

// ═══════════════════════════════════════════════════════════
//  SYNC STATUS
// ═══════════════════════════════════════════════════════════
function setSyncStatus(state, text) {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  dot.className = 'sync-dot' + (state === 'loading' ? ' loading' : state === 'error' ? ' error' : '');
  txt.textContent = text;
}

// ═══════════════════════════════════════════════════════════
//  NORMALIZAR FECHA
// ═══════════════════════════════════════════════════════════
function normalizarFecha(val) {
  return Logic.normalizarFecha(val);
}

// ═══════════════════════════════════════════════════════════
//  API - CARGAR RESERVAS (Optimizado: 1 solo fetch)
// ═══════════════════════════════════════════════════════════
async function cargarReservas() {
  if (!IS_CONFIGURED) {
    document.getElementById('setupWarning').style.display = 'block';
    setSyncStatus('error', 'Sin configurar');
    return;
  }
  if (formularioActivo) {
    setSyncStatus('ok', 'En pausa · formulario activo');
    return;
  }
  
  const cacheLocal = localStorage.getItem('reservas_cache');
  if (cacheLocal) {
    try {
      reservas = JSON.parse(cacheLocal);
      document.getElementById('connectionBanner').style.display = 'none';
      renderAll();
      setSyncStatus('ok', 'Caché local · actualizando…');
    } catch(e) { localStorage.removeItem('reservas_cache'); }
  } else {
    setSyncStatus('loading', 'Cargando…');
  }

  try {
    // V2-FIX#2: GET sin token. Solo lectura pública mínima (proyección).
    // El token de escritura viaja SOLO en body POST.
    const url = API_URL + '?t=' + Date.now();
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    const data = await res.json();
    if (data.ok) {
      // V2-FIX#3: el servidor dice si el caller es admin (server-side).
      adminSession = data.isAdmin === true;
      try {
        localStorage.setItem('admin_session', adminSession ? 'true' : 'false');
      } catch (e) {}
      if (data.mantenimiento && adminSession && (!data.reservas || data.reservas.length === 0)) {
        setSyncStatus('ok', 'Modo mantenimiento · datos locales');
        return;
      }
      if (data.mantenimiento && !adminSession) {
        localStorage.removeItem('reservas_cache');
        activarMantenimiento(false);
        return;
      }

      reservas = (data.reservas || []).map(r => ({
        ...r,
        Entrada: normalizarFecha(r.Entrada),
        Salida:  normalizarFecha(r.Salida),
        Socio:   (r.Socio   || '').toString().trim(),
        Cargada: (r.Cargada || '').toString().trim()
      }));
      
      if (data.config && data.config.length > 0) {
        cabañasConfig = data.config.map(c => ({
          id: Number(c.id),
          nombre: c.nombre || 'Cabaña ' + c.id,
          tarifa: Number(c.tarifa) || 0,
          capacidad: Number(c.capacidad) || 0,
          descripcion: c.descripcion || ''
        }));
        localStorage.setItem(CONFIG_KEY, JSON.stringify(cabañasConfig));
        actualizarSelectoresCabaña();
      }
      
      if (!data.mantenimiento) {
        localStorage.setItem('reservas_cache', JSON.stringify(reservas));
      }
      
      setSyncStatus('ok', 'Sincronizado · ' + new Date().toLocaleTimeString('es-AR'));
      document.getElementById('connectionBanner').style.display = 'none';
      if (identidadSeleccionada || usuarioActual) {
        const modal = document.getElementById('idModal');
        modal.style.display = 'none';
        modal.style.pointerEvents = 'none';
        modal.style.visibility = 'hidden';
      }
      renderAll();
    } else {
      document.getElementById('connectionBanner').style.display = 'none';
      setSyncStatus('error', 'Error al cargar');
      console.error(data.error);
    }
  } catch (e) {
    document.getElementById('connectionBanner').style.display = 'none';
    setSyncStatus('error', 'Sin conexión');
    console.error(e);
  }
}

// ═══════════════════════════════════════════════════════════
//  API - CREAR RESERVA
// ═══════════════════════════════════════════════════════════
async function apiCrear(reservaData) {
  const res = await fetch(API_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'crear', token: WRITE_TOKEN, reserva: reservaData })
  });
  return await res.json();
}

// ═══════════════════════════════════════════════════════════
//  API - EDITAR RESERVA
// ═══════════════════════════════════════════════════════════
async function apiEditar(id, reservaData) {
  const res = await fetch(API_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'editar', token: WRITE_TOKEN, id: id, reserva: reservaData })
  });
  return await res.json();
}

// ═══════════════════════════════════════════════════════════
//  API - ELIMINAR RESERVA
// ═══════════════════════════════════════════════════════════
async function apiEliminar(id) {
  const res = await fetch(API_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'eliminar', token: WRITE_TOKEN, id: id })
  });
  return await res.json();
}

// ═══════════════════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════════════════
function showTab(t) {
  ['calendario','nueva','listado','finanzas','historial','config'].forEach(tab => {
    document.getElementById('nav-'+tab) && document.getElementById('nav-'+tab).classList.toggle('active', tab===t);
    document.getElementById('panel-'+tab) && document.getElementById('panel-'+tab).classList.toggle('active', tab===t);
  });
  if (t !== 'nueva' && formularioActivo) {
    formularioActivo = false;
    setSyncStatus('ok', 'Sincronizado · ' + new Date().toLocaleTimeString('es-AR'));
  }
  if (t === 'listado') {
    document.getElementById('filtMes').value    = '';
    document.getElementById('filtSocio').value  = '';
    document.getElementById('filtBuscar').value = '';
    renderListado();
  }
  if (t === 'calendario') renderCalendario();
  if (t === 'finanzas')   renderFinanzas();
  if (t === 'historial')  renderHistorial();
  if (t === 'config')     renderConfig();
}

// ═══════════════════════════════════════════════════════════
//  CALENDARIO
// ═══════════════════════════════════════════════════════════
const MESES = Logic.MESES;
const DIAS_SHORT = ['D','L','M','X','J','V','S'];

function goToday() {
  const n = new Date();
  calYear = n.getFullYear(); calMonth = n.getMonth();
  renderCalendario();
  renderDisponibilidad();
}
function changeMonth(d) {
  const targetMonth = calMonth + d;
  let checkM = targetMonth;
  let checkY = calYear;
  if (checkM < 0) { checkM = 11; checkY--; }
  if (checkM > 11) { checkM = 0; checkY++; }
  
  // Solo bloquear retroceso si el mes destino es anterior al mes actual
  if (d === -1) {
    const now = new Date();
    const mesActual = now.getMonth();
    const anioActual = now.getFullYear();
    
    if (checkY < anioActual || (checkY === anioActual && checkM < mesActual)) {
      const msgEl = document.getElementById('noPrevMsg');
      if (msgEl) {
        msgEl.style.display = 'block';
        msgEl.style.opacity = '1';
        setTimeout(() => { msgEl.style.opacity = '0'; setTimeout(() => msgEl.style.display = 'none', 300); }, 2000);
      }
      return;
    }
  }

  calMonth = checkM;
  calYear = checkY;
  renderCalendario();
  renderDisponibilidad();
}
function ds(y,m,d) {
  return Logic.ds(y,m,d);
}

function renderMesesNav() {
  const nav = document.getElementById('calMonthsNav');
  if (!nav) return;
  
  const now = new Date();
  const mesActual = now.getMonth();
  const anioActual = now.getFullYear();
  
  // Guardar pares [año, mes] con reservas
  const mesesConReservas = new Set();
  reservas.forEach(r => {
    if (r.Entrada) {
      const d = new Date(r.Entrada + 'T12:00:00');
      mesesConReservas.add(d.getFullYear() + '-' + d.getMonth());
    }
  });

  // Recopilar todos los años que tienen reservas
  const aniosConReservas = new Set();
  mesesConReservas.forEach(key => {
    aniosConReservas.add(Number(key.split('-')[0]));
  });
  // Agregar año actual y del calendario
  aniosConReservas.add(anioActual);
  aniosConReservas.add(calYear);

  let html = '';
  const aniosOrdenados = Array.from(aniosConReservas).sort((a, b) => a - b);
  
  aniosOrdenados.forEach(anio => {
    MESES.forEach((nombre, mes) => {
      const key = anio + '-' + mes;
      // No mostrar el mes/año que estoy viendo
      if (anio === calYear && mes === calMonth) return;
      // No mostrar el botón del mes actual real si estamos en otro mes (se usa "Hoy")
      if (anio === anioActual && mes === mesActual) return;
      
      if (mesesConReservas.has(key)) {
        const cls = 'cal-month-dot has-reservas';
        const corto = nombre.substring(0, 3).toUpperCase();
        const label = (anio !== anioActual) ? `${corto} ${String(anio).slice(2)}` : corto;
        html += `<button class="${cls}" onclick="calMonth=${mes};calYear=${anio};renderCalendario();renderDisponibilidad();">${label}</button>`;
      }
    });
  });

  nav.innerHTML = html;
  
  // Ocultar botón "Hoy" hardcodeado del HTML cuando estamos en el mes/año actual
  const btnHoy = document.querySelector('.btn-today');
  if (btnHoy) btnHoy.style.display = (calMonth === mesActual && calYear === anioActual) ? 'none' : '';
}

function fmtFecha(s) {
  return Logic.fmtFecha(s);
}

function renderCalendario() {
  // V2-WIN#5: no re-render si no cambió nada (mismo guard que renderListado).
  const calKey = calYear + '-' + calMonth + '|' + reservas.map(r => r.ID).join(',');
  if (renderCalendario._lastKey === calKey) return;
  renderCalendario._lastKey = calKey;
  document.getElementById('calTitle').textContent = MESES[calMonth] + ' ' + calYear;
  renderMesesNav();
  const dim   = new Date(calYear, calMonth+1, 0).getDate();
  const today = new Date();
  const todayS= ds(today.getFullYear(), today.getMonth(), today.getDate());

  // Pre-indexar reservas por cabaña+fecha para lookup O(1)
  const resMap = {};
  reservas.forEach(r => {
    let d = new Date(r.Entrada + 'T12:00:00');
    const end = new Date(r.Salida + 'T12:00:00');
    while (d <= end) {
      const key = r.Cabaña + '|' + ds(d.getFullYear(), d.getMonth(), d.getDate());
      if (!resMap[key]) resMap[key] = [];
      resMap[key].push(r);
      d.setDate(d.getDate() + 1);
    }
  });

  let html = '<thead><tr><th class="ch-cab">Cabaña</th>';
  for (let d=1; d<=dim; d++) {
    const dow = new Date(calYear, calMonth, d).getDay();
    const isWE = dow===0||dow===6;
    html += `<th>${d}<br><span style="font-size:9px;${isWE?'color:var(--primary);font-weight:600;':''}">${DIAS_SHORT[dow]}</span></th>`;
  }
  html += '</tr></thead><tbody>';

  for (let c=1; c<=8; c++) {
    const cab = cabañasConfig[c-1].nombre;
    html += `<tr><td class="cab-label-cell">${cab}</td>`;
    for (let d=1; d<=dim; d++) {
      const dStr   = ds(calYear, calMonth, d);
      const dow    = new Date(calYear, calMonth, d).getDay();
      const isWE   = dow===0||dow===6;
      const key = cab + '|' + dStr;
      const rList = resMap[key];
      const r = rList ? rList[0] : null;
      const isToday= dStr===todayS;
      let cls='', title='', inner='';

      if (r) {
        const estado = (r.Estado||'Confirmada').toLowerCase().replace(' ','');
        let colorPfx;
        if (estado === 'ocupada')         colorPfx = 'ocupada';
        else if (estado === 'confirmada') colorPfx = 'confirmada';
        else                              colorPfx = 'noconfirmada';

        const noches = Math.round((new Date(r.Salida)-new Date(r.Entrada))/864e5);

        let pos;
        if (dStr === r.Entrada)     pos = 'start';
        else if (dStr === r.Salida) pos = 'end';
        else                        pos = 'mid';

        const nuevaEntrada = (pos === 'end') && reservas.find(rx =>
          rx.ID !== r.ID && rx.Cabaña === cab && rx.Entrada === dStr
        );

        if (pos === 'end' && !nuevaEntrada) {
          cls   = `day-trans-${colorPfx}`;
          title = `Checkout hasta 11hs: ${esc(r.Nombre)} · Disponible desde las 13hs`;
          inner = `<span style="font-size:9px;font-weight:700;position:relative;z-index:1;color:white;">${noches}n</span>`;
        } else {
          cls   = `day-${colorPfx}-${pos}`;
          title = `[${esc(r.Estado || 'Confirmada')}] ${esc(r.Nombre)} (${esc(r.Entrada)} → ${esc(r.Salida)})`;
          if (pos === 'start') inner = `<span class="day-label" title="${esc(title)}">${esc((r.Nombre || '').split(' ')[0])}</span>`;
          if (pos === 'end')   inner = `<span style="font-size:9px;font-weight:700;" title="${noches} noches">${noches}n</span>`;
        }
      } else {
        if (dStr < todayS) {
          cls = 'day-past' + (isWE?' weekend':'');
        } else {
          cls = 'day-free' + (isWE?' weekend':'');
        }
      }

      if (isToday) cls += ' day-today';
      const isPastDate = dStr < todayS;
      const esTransicion = cls.startsWith('day-trans-');
      
      // Clic: reserva pasada → nada. Reserva vigente → editar. Día libre → nueva. Transición hoy → nueva.
      let click = '';
      if (r && !esTransicion && !isPastDate) {
        click = `onclick="editarReserva('${r.ID}')"`;
        title = `[${r.Estado||'Confirmada'}] ${r.Nombre} (${r.Entrada} → ${r.Salida}) — Clic para editar`;
      } else if (!r && !isPastDate) {
        click = `onclick="quickBook('${cab}','${dStr}')"`;
      } else if (esTransicion && !isPastDate) {
        // Checkout hoy: disponible desde 13hs → se puede reservar
        click = `onclick="quickBook('${cab}','${dStr}')"`;
      }
      html += `<td class="${cls}" title="${esc(title || '')}" ${click}>${inner}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody>';
  document.getElementById('calTable').innerHTML = html;
}

function getReservaEn(cab, dStr) {
  return Logic.getReservaEn(reservas, cab, dStr);
}

function quickBook(cab, dStr) {
  showTab('nueva');
  const dNext = new Date(dStr);
  dNext.setDate(dNext.getDate() + 1);
  const salidaStr = ds(dNext.getFullYear(), dNext.getMonth(), dNext.getDate());
  document.getElementById('fCabaña').value = cab;
  document.getElementById('fEntrada').value = dStr;
  document.getElementById('fSalida').value  = salidaStr;
  setTimeout(checkConflict, 50);
  window.scrollTo({top:0, behavior:'smooth'});
}

// ═══════════════════════════════════════════════════════════
//  CONFLICTO EN TIEMPO REAL
// ═══════════════════════════════════════════════════════════
function checkConflict() {
  const cab    = document.getElementById('fCabaña').value;
  const ent    = document.getElementById('fEntrada').value;
  const sal    = document.getElementById('fSalida').value;
  const estado = document.getElementById('fEstado').value;
  const el     = document.getElementById('alertConflicto');

  // Auto-calcular fecha de salida: entrada + 1 día
  if (ent) {
    const nextDay = new Date(ent + 'T12:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayStr = ds(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate());
    
    if (!sal || sal <= ent) {
      document.getElementById('fSalida').value = nextDayStr;
    }
  }

  el.classList.remove('show');
  document.getElementById('alertError').classList.remove('show');

  // Validar: Ocupada solo puede ser hoy o fecha pasada
  if (estado === 'Ocupada' && ent) {
    const hoy = ds(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    if (ent > hoy) {
      document.getElementById('alertError').innerHTML = '❌ No se puede marcar como <strong>Ocupada</strong> con fecha de entrada futura. La entrada debe ser hoy o una fecha pasada.';
      document.getElementById('alertError').classList.add('show');
    }
  }

  const badge = document.getElementById('estadoBadge');
  if (estado === 'Ocupada') {
    badge.style.background='#b80000'; badge.style.color='white'; badge.textContent='🔴 Ocupada';
  } else if (estado === 'Confirmada') {
    badge.style.background='#FF8C00'; badge.style.color='white'; badge.textContent='🟠 Reserva confirmada';
  } else if (estado === 'No confirmada') {
    badge.style.background='#FAD201'; badge.style.color='#4a3800'; badge.textContent='🟡 Reserva no confirmada';
  } else {
    badge.style.background='var(--surface2)'; badge.style.color='var(--text-muted)'; badge.textContent='Sin estado seleccionado';
  }

  // Re-leer salida después de posible auto-cálculo
  const salActual = document.getElementById('fSalida').value;

  if (ent && salActual) {
    if (salActual <= ent) {
      document.getElementById('fNoches').value = '⚠️ Fecha inválida';
      document.getElementById('alertError').innerHTML = '❌ La fecha de salida debe ser posterior a la de entrada.';
      document.getElementById('alertError').classList.add('show');
      return;
    }
    document.getElementById('alertError').classList.remove('show');
    const noches = Math.round((new Date(salActual)-new Date(ent))/(864e5));
    document.getElementById('fNoches').value = noches + ' noche' + (noches!==1?'s':'');
    if (cab) {
      const tarifa = tarifaCabaña(cab);
      const campoMonto = document.getElementById('fMonto');
      if (tarifa > 0 && (!campoMonto.value || campoMonto.dataset.autoCalc === 'true')) {
        campoMonto.value = tarifa * noches;
        campoMonto.dataset.autoCalc = 'true';
        campoMonto.title = `Calculado: $${tarifa.toLocaleString('es-AR')} × ${noches} noches`;
      }
    }
  } else {
    document.getElementById('fNoches').value = '';
  }

  if (!cab) { el.classList.remove('show'); return; }

  if (!ent || !salActual) {
    const today = new Date();
    const todayS = ds(today.getFullYear(), today.getMonth(), today.getDate());
    const activas = reservas.filter(r => r.Cabaña===cab && r.Salida>=todayS);
    if (activas.length > 0) {
      const lista = activas.map(r => `<strong>${esc(r.Nombre)}</strong> (${esc(r.Estado)}) ${esc(r.Entrada)} → ${esc(r.Salida)}`).join('<br>');
      el.innerHTML = `⚠️ <strong>${esc(cab)}</strong> tiene estas reservas activas o futuras:<br>${lista}`;
      el.classList.add('show');
    } else {
      el.classList.remove('show');
    }
    return;
  }

  const conflictos = reservas.filter(r =>
    r.Cabaña === cab &&
    ent < r.Salida &&
    salActual > r.Entrada &&
    ent !== r.Salida
  );
  if (conflictos.length > 0) {
    el.innerHTML = `⚠️ <strong>¡Conflicto!</strong> ${esc(cab)} ya tiene una reserva de <strong>${esc(conflictos[0].Nombre)}</strong> del ${esc(fmtFecha(conflictos[0].Entrada))} al ${esc(fmtFecha(conflictos[0].Salida))}. Elegí otra cabaña u otras fechas.`;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

// ═══════════════════════════════════════════════════════════
//  GUARDAR RESERVA
// ═══════════════════════════════════════════════════════════
async function guardarReserva() {
  const cab    = document.getElementById('fCabaña').value;
  const tipo   = document.getElementById('fTipo').value;
  const estado = document.getElementById('fEstado').value;
  const nombre = document.getElementById('fNombre').value.trim();
  const dni    = document.getElementById('fDni').value.trim();
  const ent    = document.getElementById('fEntrada').value;
  const sal    = document.getElementById('fSalida').value;

  hideAlerts();
  if (!cab)    { showErr('Seleccioná la cabaña.'); return; }
  if (!tipo)   { showErr('Elegí si es Particular o Empresa.'); return; }
  if (!estado) { showErr('Elegí el estado de la reserva (ocupada / confirmada / no confirmada).'); return; }
  if (!nombre) { showErr('Ingresá el nombre y apellido del cliente.'); return; }
  if (!dni)    { showErr('Ingresá el DNI o CUIT.'); return; }
    if (!ent)    { showErr('Seleccioná la fecha de entrada.'); return; }
    if (!sal)    { showErr('Seleccioná la fecha de salida.'); return; }
  if (sal<=ent){ showErr('La fecha de salida debe ser posterior a la entrada.'); return; }

  const hoy = ds(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  if (ent < hoy) { showErr('La fecha de entrada no puede ser anterior al día de hoy (' + hoy + ').'); return; }
  if (estado === 'Ocupada' && ent > hoy) { showErr('No se puede marcar como Ocupada con fecha de entrada futura. Usá Confirmada o No confirmada.'); return; }

  const conflictos = reservas.filter(r =>
    r.Cabaña === cab &&
    ent < r.Salida &&
    sal > r.Entrada &&
    ent !== r.Salida &&
    r.ID.toString() !== (document.getElementById('fEditId').value||'').toString()
  );
  if (conflictos.length>0) {
    showErr('¡Conflicto de fechas! '+cab+' ya está reservada por '+conflictos[0].Nombre+' del '+conflictos[0].Entrada+' al '+conflictos[0].Salida+'.');
    return;
  }

  const payload = {
    cabaña:  cab, tipo: tipo, estado: estado, nombre: nombre, dni: dni,
    tel:     document.getElementById('fTel').value.trim(),
    email:   document.getElementById('fEmail').value.trim(),
    dir:     document.getElementById('fDir').value.trim(),
    entrada: ent, salida: sal,
    pago:    document.getElementById('fPago').value,
    monto:   document.getElementById('fMonto').value,
    obs:     document.getElementById('fObs').value.trim(),
    notaInterna: document.getElementById('fNotaInterna').value.trim(),
    socio:   usuarioActual || document.getElementById('fSocio').value,
  };

  const btn = document.getElementById('btnGuardar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Guardando…';
  document.getElementById('loadingOverlay').style.display = 'flex';

  try {
    let result;
    if (IS_CONFIGURED) {
      result = await apiCrear(payload);
    } else {
      result = { ok: true, id: Date.now(), noches: Math.round((new Date(sal)-new Date(ent))/864e5), cargada: new Date().toLocaleString('es-AR') };
      reservas.push({ ID: result.id, Cabaña: cab, Tipo: tipo, Estado: estado, Nombre: nombre, DNI_CUIT: dni, Telefono: payload.tel, Email: payload.email, Direccion: payload.dir, Entrada: ent, Salida: sal, Noches: result.noches, Pago: payload.pago, Monto: payload.monto, Observaciones: payload.obs, NotaInterna: payload.notaInterna, Socio: payload.socio, Cargada: result.cargada });
    }

    if (result.ok) {
      formularioActivo = false;
      agregarHistorial(document.getElementById('fEditId').value ? 'editar' : 'crear', { ID: result.id, Cabaña: cab, Nombre: nombre }, usuarioActual);
      if (IS_CONFIGURED) await cargarReservas();
      const noches = result.noches;
      showOk(`✅ Reserva guardada correctamente. ${nombre} en ${cab}, ${noches} noche${noches!==1?'s':''}.`);
      clearForm();
      renderAll();
    } else if (result.conflicto) {
      showErr('⚠️ Conflicto detectado en el servidor: ' + result.error);
    } else {
      showErr('Error al guardar: ' + result.error);
    }
  } catch(e) {
    showErr('Error de conexión al guardar. Verificá tu conexión a internet.');
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '💾 Guardar reserva';
    document.getElementById('loadingOverlay').style.display = 'none';
  }
}

// ═══════════════════════════════════════════════════════════
//  GUARDAR CON EDICIÓN
// ═══════════════════════════════════════════════════════════
async function guardarReservaConEdicion() {
  const editId = document.getElementById('fEditId').value;

  if (editId) {
    const original = reservas.find(r => r.ID.toString() === editId.toString());
    agregarHistorial('editar', original || { ID: editId }, usuarioActual);

    const cab    = document.getElementById('fCabaña').value;
    const tipo   = document.getElementById('fTipo').value;
    const estado = document.getElementById('fEstado').value;
    const nombre = document.getElementById('fNombre').value.trim();
    const dni    = document.getElementById('fDni').value.trim();
    const ent    = document.getElementById('fEntrada').value;
    const sal    = document.getElementById('fSalida').value;
    const hoy = ds(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
    hideAlerts();
    if (!cab)    { showErr('Seleccioná la cabaña.'); return; }
    if (!tipo)   { showErr('Elegí Particular o Empresa.'); return; }
    if (!estado) { showErr('Elegí el estado.'); return; }
    if (!nombre) { showErr('Ingresá el nombre del cliente.'); return; }
    if (!dni)    { showErr('Ingresá el DNI o CUIT.'); return; }
    if (!ent)    { showErr('Seleccioná la fecha de entrada.'); return; }
    if (!sal)    { showErr('Seleccioná la fecha de salida.'); return; }
    if (sal <= ent) { showErr('La fecha de salida debe ser posterior a la de entrada.'); return; }

    const payload = {
      cabaña:      cab,
      tipo,   estado,   nombre,   dni,
      tel:         document.getElementById('fTel').value.trim(),
      email:       document.getElementById('fEmail').value.trim(),
      dir:         document.getElementById('fDir').value.trim(),
      entrada:     ent,
      salida:      sal,
      pago:        document.getElementById('fPago').value,
      monto:       document.getElementById('fMonto').value,
      obs:         document.getElementById('fObs').value.trim(),
      notaInterna: document.getElementById('fNotaInterna').value.trim(),
      socio:       usuarioActual || document.getElementById('fSocio').value,
    };

    const btn = document.getElementById('btnGuardar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Guardando…';
    document.getElementById('loadingOverlay').style.display = 'flex';

    try {
      let result;
      if (IS_CONFIGURED) {
        result = await apiEditar(editId, payload);
      } else {
        const idx = reservas.findIndex(r => r.ID.toString() === editId.toString());
        if (idx !== -1) {
          const noches = Math.round((new Date(sal)-new Date(ent))/864e5);
          reservas[idx] = { ...reservas[idx], Cabaña:cab, Tipo:tipo, Estado:estado,
            Nombre:nombre, DNI_CUIT:dni, Telefono:payload.tel, Email:payload.email,
            Direccion:payload.dir, Entrada:ent, Salida:sal, Noches:noches,
            Pago:payload.pago, Monto:payload.monto, Observaciones:payload.obs,
            NotaInterna:payload.notaInterna, Socio:payload.socio };
          result = { ok: true, noches, cargada: reservas[idx].Cargada };
        } else {
          result = { ok: false, error: 'Reserva no encontrada en modo demo.' };
        }
      }

      if (result.ok) {
        formularioActivo = false;
        if (IS_CONFIGURED) await cargarReservas();
        else renderAll();
        showOk('✅ Reserva de ' + nombre + ' actualizada correctamente.', 'sonidoEditar');
        clearForm();
      } else if (result.conflicto) {
        showErr('⚠️ Conflicto en servidor: ' + result.error);
      } else {
        showErr('Error al editar: ' + result.error);
      }
    } catch(e) {
      showErr('Error de conexión al guardar. Verificá tu internet.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '💾 Guardar cambios';
      document.getElementById('loadingOverlay').style.display = 'none';
    }

  } else {
    await guardarReserva();
  }
}

// ═══════════════════════════════════════════════════════════
//  ELIMINAR RESERVA
// ═══════════════════════════════════════════════════════════
async function eliminar(id, nombre, socioCargo) {
  if (!usuarioActual) {
    alert('Primero seleccioná tu nombre en la parte superior.');
    return;
  }
  if (!adminSession && usuarioActual.trim().toLowerCase() !== (socioCargo||'').trim().toLowerCase()) {
    alert('⛔ No podés eliminar esta reserva.\nSolo ' + socioCargo + ' puede eliminarla porque fue quien la cargó.');
    return;
  }
  if (!confirm('¿Eliminar la reserva de ' + nombre + '?\nEsta acción no se puede deshacer.')) return;
  agregarHistorial('eliminar', { ID: id, Cabaña: '—', Nombre: nombre }, usuarioActual);
  setSyncStatus('loading', 'Eliminando…');
  try {
    if (IS_CONFIGURED) {
      const result = await apiEliminar(id);
      if (result.ok) { await cargarReservas(); document.getElementById('sonidoBorrar').play().catch(()=>{}); }
      else alert('Error al eliminar: ' + result.error);
    } else {
      reservas = reservas.filter(r=>r.ID.toString()!==id.toString());
      renderAll();
      document.getElementById('sonidoBorrar').play().catch(()=>{});
    }
    setSyncStatus('ok', 'Sincronizado · ' + new Date().toLocaleTimeString('es-AR'));
  } catch(e) {
    setSyncStatus('error', 'Error al eliminar');
  }
}

// ═══════════════════════════════════════════════════════════
//  LISTADO
// ═══════════════════════════════════════════════════════════
function renderListado() {
  const filtCab    = document.getElementById('filtCabaña').value;
  const filtEstado = document.getElementById('filtEstado').value;
  const filtTipo   = document.getElementById('filtTipo').value;
  const filtSocio  = document.getElementById('filtSocio').value;
  const filtMes    = document.getElementById('filtMes').value;
  const filtOrden  = document.getElementById('filtOrden').value;
  const filtBuscar = (document.getElementById('filtBuscar')?.value||'').toLowerCase().trim();

  let lista = [...reservas];

  // Aplicar filtros primero
  if (filtCab)    lista = lista.filter(r=>r.Cabaña===filtCab);
  if (filtEstado) lista = lista.filter(r=>r.Estado===filtEstado);
  if (filtTipo)   lista = lista.filter(r=>r.Tipo===filtTipo);
  if (filtSocio)  lista = lista.filter(r=>r.Socio===filtSocio);
  if (filtMes)    lista = lista.filter(r=>(r.Entrada||'').startsWith(filtMes)||(r.Salida||'').startsWith(filtMes));
  if (filtBuscar) lista = lista.filter(r=>
    (r.Nombre||'').toLowerCase().includes(filtBuscar) ||
    (r.DNI_CUIT||'').toLowerCase().includes(filtBuscar)
  );

  // Ordenar según selección
  lista.sort((a,b) => {
    const numA = parseInt((a.Cabaña||'').replace(/\D/g,'')) || 0;
    const numB = parseInt((b.Cabaña||'').replace(/\D/g,'')) || 0;

    if (!filtOrden) {
      // Default: Cabaña ↑ luego Fecha ↑
      if (numA !== numB) return numA - numB;
      return a.Entrada < b.Entrada ? -1 : 1;
    }
    if (filtOrden === 'mes') {
      // Dentro del mes, ordenar por fecha
      return a.Entrada < b.Entrada ? -1 : a.Entrada > b.Entrada ? 1 : 0;
    }
    switch(filtOrden) {
      case 'cab-asc':
        return numA - numB;
      case 'cab-desc':
        return numB - numA;
      case 'nombre-asc':
        return (a.Nombre||'').localeCompare(b.Nombre||'');
      case 'nombre-desc':
        return (b.Nombre||'').localeCompare(a.Nombre||'');
      case 'socio-asc':
        return (a.Socio||'').localeCompare(b.Socio||'');
      case 'fecha-asc':
        return a.Entrada < b.Entrada ? -1 : a.Entrada > b.Entrada ? 1 : 0;
      case 'fecha-desc':
        return b.Entrada < a.Entrada ? -1 : b.Entrada > a.Entrada ? 1 : 0;
      default:
        return 0;
    }
  });

  const listaKey = lista.map(r=>r.ID).join(',');
  const cacheKey = JSON.stringify({usuarioActual, filtCab, filtEstado, filtTipo, filtSocio, filtMes, filtBuscar, filtOrden, vistaListado});
  if (renderListado._lastKey === listaKey && renderListado._lastFilters === cacheKey) return;
  renderListado._lastKey = listaKey;
  renderListado._lastFilters = cacheKey;

  const el = document.getElementById('listaReservas');
  if (lista.length===0) {
    el.innerHTML=`
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">Sin reservas</div>
        <div class="empty-sub">No hay reservas con ese filtro.</div>
      </div>`;
    return;
  }

  // Renderizar
  let html = '';
  const esGrilla = vistaListado === 'grid';

  // Agrupar por mes (siempre)
  const grupos = {};
  lista.forEach(r => {
    const mes = (r.Entrada||'').substring(0,7);
    if (!grupos[mes]) grupos[mes] = [];
    grupos[mes].push(r);
  });

  if (esGrilla) {
    html += '<div class="reservas-list vista-grid">';
    Object.keys(grupos).sort().forEach(mes => {
      const [y, m] = mes.split('-');
      const mesNombre = MESES[parseInt(m)-1] + ' ' + y;
      html += `<div class="mes-header-grid">📅 ${mesNombre.toUpperCase()}</div>`;
      grupos[mes].forEach(r => { html += renderCard(r); });
    });
    html += '</div>';
  } else {
    Object.keys(grupos).sort().forEach(mes => {
      const [y, m] = mes.split('-');
      const mesNombre = MESES[parseInt(m)-1] + ' ' + y;
      html += `<div style="font-size:14px;font-weight:700;color:var(--primary);margin:16px 0 8px;border-bottom:2px solid var(--primary);padding-bottom:4px;">📅 ${mesNombre.toUpperCase()}</div>`;
      html += '<div class="reservas-list">';
      grupos[mes].forEach(r => { html += renderCard(r); });
      html += '</div>';
    });
  }

  el.innerHTML = html;
}

function renderCard(r) {
  const noches = r.Noches || Math.round((new Date(r.Salida)-new Date(r.Entrada))/864e5);
  const monto  = r.Monto ? '$'+Number(r.Monto).toLocaleString('es-AR') : '';
  const entradaFmt = fmtFecha(r.Entrada);
  const salidaFmt  = fmtFecha(r.Salida);

  const estadoBadge = r.Estado==='Ocupada'
    ? '<span class="chip" style="background:#b80000;color:white;border:1px solid #900000;">🔴 Ocupada</span>'
    : r.Estado==='Confirmada'
    ? '<span class="chip" style="background:#FF8C00;color:white;border:1px solid #cc6e00;">🟠 Confirmada</span>'
    : r.Estado==='No confirmada'
    ? '<span class="chip" style="background:#FAD201;color:#4a3800;border:1px solid #c8a200;">🟡 No confirmada</span>'
    : '';

  const esAdmin = adminSession;
  const esDueño = esAdmin || !!(usuarioActual &&
    usuarioActual.trim().toLowerCase() === (r.Socio||'').trim().toLowerCase());

  const btnEliminar = esDueño
    ? `<button class="rc-delete" onclick="eliminar('${esc(r.ID)}','${esc((r.Nombre || '').replace(/'/g, ''))}','${esc((r.Socio || '').replace(/'/g, ''))}')">🗑️</button>`
    : `<button class="rc-delete" disabled title="Solo ${esc(r.Socio || 'quien la cargó')} puede eliminar esta reserva." style="opacity:0.35;cursor:not-allowed;">🔒</button>`;

  const btnEditar = esDueño
    ? `<button class="btn-secondary" onclick="editarReserva('${esc(r.ID)}')" style="font-size:12px;padding:5px 10px;">✏️ Editar</button>`
    : `<button class="btn-secondary" disabled title="Solo ${esc(r.Socio || 'quien la cargó')} puede editar esta reserva." style="font-size:12px;padding:5px 10px;opacity:0.35;cursor:not-allowed;">✏️ Editar</button>`;

  const cargadaFmt = r.Cargada
    ? r.Cargada.replace(/GMT.*/,'').trim()
    : '—';

  return `
  <div class="reserva-card">
    <div class="rc-row1">
      <div>
        <div class="rc-name">🏕️ ${esc(r.Cabaña)} — ${esc(r.Nombre || '—')}</div>
        <div class="rc-sub">DNI/CUIT: ${esc(r.DNI_CUIT || '—')}${r.Telefono ? ' · ' + esc(r.Telefono) : ''}${r.Email ? ' · ' + esc(r.Email) : ''}</div>
        ${r.Direccion ? '<div class="rc-sub">' + esc(r.Direccion) + '</div>' : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:flex-start;">
        ${btnEditar}
        ${btnEliminar}
      </div>
    </div>
    <div class="rc-chips">
      ${estadoBadge}
      <span class="chip ${r.Tipo === 'Empresa' ? 'chip-amber' : 'chip-blue'}">${esc(r.Tipo || '—')}</span>
      <span class="chip chip-green">🌙 ${noches} noche${noches !== 1 ? 's' : ''}</span>
      ${monto ? `<span class="chip chip-green">${esc(monto)}</span>` : ''}
      ${r.Pago ? `<span class="chip chip-gray">${esc(r.Pago)}</span>` : ''}
      ${r.Socio ? `<span class="chip chip-gray">👤 ${esc(r.Socio)}</span>` : ''}
    </div>
    <div class="rc-sub" style="margin-top:8px;">📅 ${esc(entradaFmt)} → ${esc(salidaFmt)}</div>
    ${r.NotaInterna && esDueño ? `<div class="rc-obs" style="border-left-color:#FF8C00;background:var(--warning-bg);margin-top:8px;" title="Nota interna — solo visible para vos">🔒 ${esc(r.NotaInterna)}</div>` : ''}
    ${r.Observaciones ? `<div class="rc-obs">📝 ${esc(r.Observaciones)}</div>` : ''}
    <div class="rc-footer">Cargada: ${esc(cargadaFmt)}</div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════
function renderStats() {
  const today  = new Date();
  const todayS = ds(today.getFullYear(), today.getMonth(), today.getDate());

  const ocupadas = reservas.filter(r =>
    r.Estado === 'Ocupada' && r.Salida >= todayS
  ).length;

  const confirmadas = reservas.filter(r =>
    r.Estado === 'Confirmada' && r.Salida >= todayS
  ).length;

  const noConfirmadas = reservas.filter(r =>
    r.Estado === 'No confirmada' && r.Salida >= todayS
  ).length;

  const total   = reservas.length;
  const ingresos= reservas.reduce((s,r)=>s+(Number(r.Monto)||0),0);
  document.getElementById('statsGrid').innerHTML=`
    <div class="stat-card" style="border-left:4px solid #b80000;">
      <div class="stat-label">🔴 Ocupadas ahora</div>
      <div class="stat-value">${ocupadas}</div>
      <div class="stat-sub">cabañas con huésped</div>
    </div>
    <div class="stat-card" style="border-left:4px solid #FF8C00;">
      <div class="stat-label">🟠 Confirmadas</div>
      <div class="stat-value">${confirmadas}</div>
      <div class="stat-sub">reservas futuras OK</div>
    </div>
    <div class="stat-card" style="border-left:4px solid #FAD201;">
      <div class="stat-label">🟡 Sin confirmar</div>
      <div class="stat-value">${noConfirmadas}</div>
      <div class="stat-sub">requieren seguimiento</div>
    </div>
    <div class="stat-card" style="border-left:4px solid #009e00;">
      <div class="stat-label">Total registradas</div>
      <div class="stat-value">${total}</div>
      <div class="stat-sub">$${ingresos.toLocaleString('es-AR')} cargados</div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════
//  DISPONIBILIDAD DEL MES VISIBLE
// ═══════════════════════════════════════════════════════════
function renderDisponibilidad() {
  const panel = document.getElementById('dispPanel');
  if (!panel) return;

  const now      = new Date();
  const todayS   = ds(now.getFullYear(), now.getMonth(), now.getDate());
  const dim      = new Date(calYear, calMonth + 1, 0).getDate();
  const mesNombre= MESES[calMonth] + ' ' + calYear;
  const esHoy    = (calYear === now.getFullYear() && calMonth === now.getMonth());

  const resumen = [];

  for (let c = 1; c <= 8; c++) {
    const cab = cabañasConfig[c-1].nombre;
    let diasLibres = 0;
    let diasOcup   = 0;
    let diasConf   = 0;
    let diasNoConf = 0;
    let primerLibre = null;
    let reservasMes = [];

    for (let d = 1; d <= dim; d++) {
      const dStr = ds(calYear, calMonth, d);
      const esPasado = dStr < todayS;
      const res = reservas.find(r => r.Cabaña === cab && dStr >= r.Entrada && dStr <= r.Salida);

      if (!res) {
        if (!esPasado) {
          diasLibres++;
          if (!primerLibre) primerLibre = d;
        }
      } else {
        if (!reservasMes.find(r => r.ID === res.ID)) reservasMes.push(res);
        if (!esPasado) {
          const est = (res.Estado||'').toLowerCase().replace(' ','');
          if (est === 'ocupada')         diasOcup++;
          else if (est === 'confirmada') diasConf++;
          else                           diasNoConf++;
        }
      }
    }

    const totalOcupados = diasOcup + diasConf + diasNoConf;
    let colorDom, labelDom;
    if (totalOcupados === 0) {
      colorDom = '#009e00'; labelDom = 'TODO LIBRE';
    } else if (diasLibres === 0) {
      colorDom = '#b80000'; labelDom = 'SIN DÍAS';
    } else {
      colorDom = '#009e00'; labelDom = diasLibres + 'd lib.';
    }

    resumen.push({ c, cab, diasLibres, diasOcup, diasConf, diasNoConf, primerLibre, reservasMes, colorDom, labelDom });
  }

  const horaStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const tituloExtra = esHoy ? ` · ${horaStr}` : '';

  let html = `
    <div class="disp-title">
      📅 RESUMEN ${mesNombre.toUpperCase()}${tituloExtra}
    </div>
    <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px;">`;

  resumen.forEach(({ c, diasLibres, diasOcup, diasConf, diasNoConf, primerLibre, reservasMes, colorDom, labelDom }) => {
    const lines = [`Cabaña ${c}`];
    if (diasLibres > 0)  lines.push(`✅ ${diasLibres} días libres`);
    if (diasOcup > 0)    lines.push(`🔴 ${diasOcup} días ocupada`);
    if (diasConf > 0)    lines.push(`🟠 ${diasConf} días confirmados`);
    if (diasNoConf > 0)  lines.push(`🟡 ${diasNoConf} días sin confirmar`);
    if (primerLibre)     lines.push(`Primer día libre: ${primerLibre}/${calMonth+1}`);
    reservasMes.forEach(r => lines.push(`• ${r.Nombre}: ${fmtFecha(r.Entrada)}→${fmtFecha(r.Salida)}`));
    const tooltip = lines.join('\n');

    const total = diasLibres + diasOcup + diasConf + diasNoConf;
    const pctOcup   = total ? Math.round(diasOcup   / dim * 100) : 0;
    const pctConf   = total ? Math.round(diasConf   / dim * 100) : 0;
    const pctNoConf = total ? Math.round(diasNoConf / dim * 100) : 0;
    const pctLibre  = 100 - pctOcup - pctConf - pctNoConf;

    let bgCaja, textColor;
    const totalOcup = diasOcup + diasConf + diasNoConf;

    if (totalOcup === 0) {
      bgCaja = '#009e00'; textColor = 'white';
      labelDom = 'TODO LIBRE';
    } else {
      bgCaja = '#C0C0C0'; textColor = '#444';
      labelDom = diasLibres > 0 ? diasLibres + 'd lib.' : 'SIN DÍAS';
    }
    const clickable = diasLibres > 0 ? `onclick="quickBookCab(${c})"` : '';
    const cursor    = diasLibres > 0 ? 'pointer' : 'default';

    html += `
      <button class="disp-box-mes" title="${tooltip}" ${clickable}
        style="background:${bgCaja};color:${textColor};cursor:${cursor};">
        <span class="dbm-num">${c}</span>
        <span class="dbm-label">${labelDom}</span>
        <div class="dbm-bar">
          ${pctOcup   > 0 ? `<div style="width:${pctOcup}%;background:#b80000;"></div>` : ''}
          ${pctConf   > 0 ? `<div style="width:${pctConf}%;background:#FF8C00;"></div>` : ''}
          ${pctNoConf > 0 ? `<div style="width:${pctNoConf}%;background:#FAD201;"></div>` : ''}
          ${pctLibre  > 0 ? `<div style="width:${pctLibre}%;background:#009e00;"></div>` : ''}
        </div>
      </button>`;
  });

  html += `</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;">
      <span style="font-size:11px;color:var(--text-muted);">Barra de ocupación del mes →</span>
      <span style="font-size:11px;display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:#009e00;border-radius:2px;display:inline-block;"></span>Libre</span>
      <span style="font-size:11px;display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:#b80000;border-radius:2px;display:inline-block;"></span>Ocupada</span>
      <span style="font-size:11px;display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:#FF8C00;border-radius:2px;display:inline-block;"></span>Confirmada</span>
      <span style="font-size:11px;display:flex;align-items:center;gap:4px;"><span style="width:12px;height:12px;background:#FAD201;border-radius:2px;display:inline-block;"></span>Sin confirmar</span>
      <span style="font-size:11px;color:var(--text-hint);">· Clic en cabaña libre para reservar</span>
    </div>`;

  panel.innerHTML = html;
}

function quickBookCab(n) {
  showTab('nueva');
  const hoy  = new Date();
  const man  = new Date(hoy); man.setDate(man.getDate() + 1);
  const entS = ds(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const salS = ds(man.getFullYear(), man.getMonth(), man.getDate());
  document.getElementById('fCabaña').value  = 'Cabaña ' + n;
  document.getElementById('fEntrada').value = entS;
  document.getElementById('fSalida').value  = salS;
  checkConflict();
  window.scrollTo({top:0, behavior:'smooth'});
}

// ═══════════════════════════════════════════════════════════
//  EXPORT CSV
// ═══════════════════════════════════════════════════════════
function exportCSV() {
  if (!reservas.length) { alert('No hay reservas para exportar.'); return; }
  const cols = ['Cabaña','Tipo','Estado','Nombre','DNI_CUIT','Telefono','Email','Direccion','Entrada','Salida','Noches','Pago','Monto','Observaciones','Socio','Cargada'];
  const rows = reservas.map(r=>cols.map(c=>`"${(r[c]||'').toString().replace(/"/g,'""')}"`).join(','));
  const csv  = [cols.join(','),...rows].join('\n');
  const blob = new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
  a.download='reservas_cabañas_'+new Date().toISOString().slice(0,10)+'.csv'; a.click();
}

// ═══════════════════════════════════════════════════════════
//  HELPERS FORMULARIO
// ═══════════════════════════════════════════════════════════
function clearForm() {
  editandoReserva = null;
  ['fCabaña','fTipo','fEstado','fPago'].forEach(id=>document.getElementById(id).value='');
  ['fNombre','fDni','fTel','fEmail','fDir','fEntrada','fSalida','fNoches','fMonto','fObs','fNotaInterna'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('fSocio').value = usuarioActual;
  document.getElementById('fEditId').value = '';
  const titulo = document.getElementById('formTitulo');
  if (titulo) titulo.textContent = '➕ Nueva reserva';
  const btn = document.getElementById('btnGuardar');
  if (btn) btn.innerHTML = '💾 Guardar reserva';
  const btnEliminar = document.getElementById('btnEliminarForm');
  if (btnEliminar) btnEliminar.style.display = 'none';
  const badge = document.getElementById('estadoBadge');
  badge.style.background='var(--surface2)'; badge.style.color='var(--text-muted)'; badge.textContent='Sin estado seleccionado';
  hideAlerts();
  formularioActivo = false;
  setSyncStatus('ok', 'Sincronizado · ' + new Date().toLocaleTimeString('es-AR'));
}
function hideAlerts() {
  ['alertConflicto','alertError','alertOk'].forEach(id=>document.getElementById(id).classList.remove('show'));
  activarBotonGuardar();
}
function showErr(msg) {
  const el=document.getElementById('alertError');
  el.innerHTML='❌ '+msg; el.classList.add('show');
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
  document.getElementById('sonidoError').play().catch(()=>{});
  desactivarBotonGuardar();
}

function showOk(msg, soundId) {
  const el=document.getElementById('alertOk');
  el.innerHTML=msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), 5000);
  if (soundId === 'sonidoEditar') { playEditar(); return; }
  document.getElementById(soundId||'sonidoExito').play().catch(()=>{});
}

function playEditar() {
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    // Double chirp estilo Twitter
    osc.type = 'sine';
    gain.gain.value = 0.25;
    osc.start();
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(880, ctx.currentTime+0.06);
    osc.frequency.setValueAtTime(0, ctx.currentTime+0.12);
    osc.frequency.setValueAtTime(660, ctx.currentTime+0.15);
    osc.frequency.setValueAtTime(990, ctx.currentTime+0.21);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+0.35);
    osc.stop(ctx.currentTime+0.35);
  } catch(e) { /* fallo silencioso */ }
}

function desactivarBotonGuardar() {
  const btn=document.getElementById('btnGuardar');
  if (!btn) return;
  btn.disabled=true;
  btn.style.opacity='0.5';
}
function activarBotonGuardar() {
  const btn=document.getElementById('btnGuardar');
  if (!btn) return;
  btn.disabled=false;
  btn.style.opacity='1';
}

// Re-activar botón cuando el usuario modifique cualquier campo del formulario
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('#formCard input, #formCard select, #formCard textarea').forEach(el=>{
    el.addEventListener('input',activarBotonGuardar);
    el.addEventListener('change',activarBotonGuardar);
  });
});

// ═══════════════════════════════════════════════════════════
//  EDITAR RESERVA
// ═══════════════════════════════════════════════════════════

/** Reserva que se está editando actualmente (para el botón eliminar en el form) */
let editandoReserva = null;

function editarReserva(id) {
  const r = reservas.find(x => x.ID.toString() === id.toString());
  if (!r) return;

  editandoReserva = { id: r.ID, nombre: r.Nombre, socio: r.Socio };

  showTab('nueva');
  document.getElementById('fEditId').value    = r.ID;
  document.getElementById('fCabaña').value    = r.Cabaña;
  document.getElementById('fTipo').value      = r.Tipo;
  document.getElementById('fEstado').value    = r.Estado;
  document.getElementById('fNombre').value    = r.Nombre;
  document.getElementById('fDni').value       = r.DNI_CUIT;
  document.getElementById('fTel').value       = r.Telefono||'';
  document.getElementById('fEmail').value     = r.Email||'';
  document.getElementById('fDir').value       = r.Direccion||'';
  document.getElementById('fEntrada').value   = r.Entrada;
  document.getElementById('fSalida').value    = r.Salida;
  document.getElementById('fPago').value      = r.Pago||'';
  document.getElementById('fMonto').value     = r.Monto||'';
  document.getElementById('fObs').value       = r.Observaciones||'';
  document.getElementById('fNotaInterna').value = r.NotaInterna||'';
  document.getElementById('formTitulo').textContent = '✏️ Editando reserva — ' + r.Nombre;
  document.getElementById('btnGuardar').innerHTML   = '💾 Guardar cambios';

  // Mostrar botón eliminar con permisos
  const btnEliminar = document.getElementById('btnEliminarForm');
  const esAdmin = adminSession;
  const esDueño = esAdmin || !!(usuarioActual &&
    usuarioActual.trim().toLowerCase() === (r.Socio||'').trim().toLowerCase());
  if (esDueño) {
    btnEliminar.style.display = 'inline-flex';
    btnEliminar.disabled = false;
    btnEliminar.title = 'Eliminar esta reserva';
  } else {
    btnEliminar.style.display = 'inline-flex';
    btnEliminar.disabled = true;
    btnEliminar.title = 'Solo ' + (r.Socio||'quien la cargó') + ' puede eliminar esta reserva.';
  }

  setTimeout(checkConflict, 50);
  window.scrollTo({top:0, behavior:'smooth'});
}

async function eliminarForm() {
  if (!editandoReserva) return;
  await eliminar(editandoReserva.id, editandoReserva.nombre||'', editandoReserva.socio||'');
  clearForm();
}

// ═══════════════════════════════════════════════════════════
//  HISTORIAL DE CAMBIOS
// ═══════════════════════════════════════════════════════════
function agregarHistorial(accion, reserva, quien) {
  try {
    const hist = JSON.parse(localStorage.getItem('cabanas_historial') || '[]');
    hist.unshift({
      accion,
      reservaId:  reserva.ID || '—',
      cabaña:     reserva.Cabaña || '—',
      cliente:    reserva.Nombre || '—',
      quien:      quien || '—',
      fecha:      new Date().toLocaleString('es-AR'),
    });
    if (hist.length > 200) hist.splice(200);
    localStorage.setItem('cabanas_historial', JSON.stringify(hist));
  } catch(e) {}
}

function renderHistorial() {
  const el = document.getElementById('panelHistorial');
  if (!el) return;
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem('cabanas_historial') || '[]'); } catch(e) {}

  const iconos = { crear: '➕', editar: '✏️', eliminar: '🗑️' };
  const colores = { crear: '#009e00', editar: '#FF8C00', eliminar: '#b80000' };

  if (hist.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🕐</div><div class="empty-title">Sin historial aún</div><div class="empty-sub">Los cambios que realices aparecerán acá.</div></div>`;
    return;
  }

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <span style="font-size:15px;font-weight:600;">Historial de cambios</span>
      <button class="btn-secondary" onclick="limpiarHistorial()" style="font-size:12px;padding:6px 12px;">🗑️ Limpiar historial</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
    ${hist.map(h=>`
      <div style="display:flex;align-items:center;gap:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;border-left:4px solid ${colores[h.accion]||'#888'};">
        <span style="font-size:20px;">${iconos[h.accion]||'•'}</span>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;">${h.accion.toUpperCase()} — ${h.cabaña} · ${h.cliente}</div>
          <div style="font-size:12px;color:var(--text-muted);">👤 ${h.quien} · ${h.fecha}</div>
        </div>
      </div>`).join('')}
    </div>`;
}

function limpiarHistorial() {
  if (!confirm('¿Limpiar todo el historial? Esta acción no se puede deshacer.')) return;
  try { localStorage.removeItem('cabanas_historial'); } catch(e) {}
  renderHistorial();
}

// ═══════════════════════════════════════════════════════════
//  ALERTAS PRÓXIMAS ENTRADAS
// ═══════════════════════════════════════════════════════════
function renderAlertasEntradas() {
  const el = document.getElementById('alertasEntradas');
  if (!el) return;
  const now    = new Date();
  const todayS = ds(now.getFullYear(), now.getMonth(), now.getDate());
  const man    = new Date(now); man.setDate(man.getDate()+1);
  const manS   = ds(man.getFullYear(), man.getMonth(), man.getDate());
  const pas    = new Date(now); pas.setDate(pas.getDate()+2);
  const pasS   = ds(pas.getFullYear(), pas.getMonth(), pas.getDate());

  const hoy48  = reservas.filter(r => r.Entrada === todayS || r.Entrada === manS || r.Entrada === pasS);
  if (hoy48.length === 0) { el.innerHTML=''; return; }

  const items = hoy48.map(r => {
    const diff = r.Entrada === todayS ? 'HOY' : r.Entrada === manS ? 'MAÑANA' : 'EN 2 DÍAS';
    const color = r.Entrada === todayS ? '#b80000' : r.Entrada === manS ? '#FF8C00' : '#FAD201';
    const textC = r.Entrada === todayS ? 'white' : r.Entrada === manS ? 'white' : '#4a3800';
    return `<span style="display:inline-flex;align-items:center;gap:6px;background:${color};color:${textC};padding:5px 12px;border-radius:20px;font-size:12px;font-weight:600;white-space:nowrap;">
      🔔 ${diff}: ${r.Cabaña} — ${r.Nombre}
    </span>`;
  }).join('');

  el.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:10px 14px;margin-bottom:1rem;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
    <span style="font-size:12px;font-weight:600;color:var(--text-muted);margin-right:4px;">PRÓXIMAS ENTRADAS:</span>
    ${items}
  </div>`;
}

// ═══════════════════════════════════════════════════════════
//  PANEL FINANZAS
// ═══════════════════════════════════════════════════════════
function renderFinanzas() {
  const el = document.getElementById('panelFinanzas');
  if (!el) return;

  const ahora = new Date();
  const mesActual = ds(ahora.getFullYear(), ahora.getMonth(), 1).substring(0,7);

  const porMes = {};
  const porCabaña = {};
  const porSocio  = {};

  reservas.forEach(r => {
    const monto = Number(r.Monto)||0;
    const mes   = (r.Entrada||'').substring(0,7);
    const cab   = r.Cabaña||'—';
    const socio = r.Socio||'—';

    if (!porMes[mes])    porMes[mes]    = { total:0, count:0 };
    if (!porCabaña[cab]) porCabaña[cab] = { total:0, count:0 };
    if (!porSocio[socio])porSocio[socio]= { total:0, count:0 };

    porMes[mes].total    += monto; porMes[mes].count++;
    porCabaña[cab].total += monto; porCabaña[cab].count++;
    porSocio[socio].total+= monto; porSocio[socio].count++;
  });

  const totalGlobal = reservas.reduce((s,r)=>s+(Number(r.Monto)||0),0);

  const tablaRows = (obj, label) => Object.entries(obj)
    .sort((a,b)=>b[1].total-a[1].total)
    .map(([k,v])=>`<tr>
      <td style="padding:8px 12px;font-weight:500;">${k}</td>
      <td style="padding:8px 12px;text-align:right;">$${v.total.toLocaleString('es-AR')}</td>
      <td style="padding:8px 12px;text-align:center;color:var(--text-muted);">${v.count} reserva${v.count!==1?'s':''}</td>
    </tr>`).join('');

  const tabla = (titulo, obj) => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--shadow-sm);">
      <div style="padding:10px 14px;background:var(--surface2);font-weight:600;font-size:13px;border-bottom:1px solid var(--border);">${titulo}</div>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">
          <th style="padding:6px 12px;text-align:left;">Concepto</th>
          <th style="padding:6px 12px;text-align:right;">Ingresos</th>
          <th style="padding:6px 12px;text-align:center;">Reservas</th>
        </tr></thead>
        <tbody>${tablaRows(obj)}</tbody>
      </table>
    </div>`;

  el.innerHTML = `
    <div style="margin-bottom:1.5rem;">
      <div style="font-size:15px;font-weight:600;margin-bottom:1rem;">💰 Resumen financiero</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:1.5rem;">
        <div class="stat-card" style="border-left:4px solid #009e00;">
          <div class="stat-label">Total ingresos</div>
          <div class="stat-value" style="font-size:20px;">$${totalGlobal.toLocaleString('es-AR')}</div>
          <div class="stat-sub">${reservas.length} reservas históricas</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #1a73e8;">
          <div class="stat-label">Mes actual</div>
          <div class="stat-value" style="font-size:20px;">$${((porMes[mesActual]||{}).total||0).toLocaleString('es-AR')}</div>
          <div class="stat-sub">${(porMes[mesActual]||{}).count||0} reservas este mes</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #FF8C00;">
          <div class="stat-label">Promedio por reserva</div>
          <div class="stat-value" style="font-size:20px;">$${reservas.length?Math.round(totalGlobal/reservas.length).toLocaleString('es-AR'):0}</div>
          <div class="stat-sub">sobre reservas con monto</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
        ${tabla('📅 Por mes', porMes)}
        ${tabla('🏕️ Por cabaña', porCabaña)}
        ${tabla('👤 Por socio', porSocio)}
      </div>
    </div>`;
}

// ═══════════════════════════════════════════════════════════
//  EXPORT PDF
// ═══════════════════════════════════════════════════════════
function exportPDF() {
  const mes = document.getElementById('filtMes').value;
  let lista = [...reservas];
  if (mes) lista = lista.filter(r=>(r.Entrada||'').startsWith(mes)||(r.Salida||'').startsWith(mes));
  lista.sort((a,b)=>{
    const nA=parseInt((a.Cabaña||'').replace(/\D/g,''))||0;
    const nB=parseInt((b.Cabaña||'').replace(/\D/g,''))||0;
    return nA-nB;
  });

  const titulo = mes ? `Reservas ${mes}` : 'Todas las reservas';
  const filas  = lista.map(r=>`
    <tr>
      <td>${r.Cabaña}</td>
      <td>${r.Nombre}</td>
      <td>${r.DNI_CUIT||''}</td>
      <td>${r.Telefono||''}</td>
      <td style="background:${r.Estado==='Ocupada'?'#b80000':r.Estado==='Confirmada'?'#FF8C00':'#FAD201'};color:${r.Estado==='No confirmada'?'#4a3800':'white'};text-align:center;">${r.Estado}</td>
      <td>${fmtFecha(r.Entrada)}</td>
      <td>${fmtFecha(r.Salida)}</td>
      <td>${r.Noches||''}</td>
      <td>$${Number(r.Monto||0).toLocaleString('es-AR')}</td>
      <td>${r.Socio||''}</td>
      <td>${r.Observaciones||''}</td>
    </tr>`).join('');

  const total = lista.reduce((s,r)=>s+(Number(r.Monto)||0),0);

  const DOC_OPEN  = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
  const DOC_STYLE = '<style>body{font-family:Arial,sans-serif;font-size:11px;padding:20px;}h2{font-size:16px;margin-bottom:12px;}table{width:100%;border-collapse:collapse;}th{background:#1a73e8;color:white;padding:6px 8px;text-align:left;font-size:10px;}td{padding:5px 8px;border-bottom:1px solid #ddd;}tr:nth-child(even){background:#f8f9fa;}.total{font-weight:bold;text-align:right;padding:8px;font-size:13px;}</style>';
  const DOC_CLOSE = '</head><body><h2>🏕️ Cabañas · '+titulo+'</h2><p style="color:#666;margin-bottom:12px;">Generado el '+new Date().toLocaleString('es-AR')+' · '+lista.length+' reservas</p><table><thead><tr><th>Cabaña</th><th>Cliente</th><th>DNI/CUIT</th><th>Teléfono</th><th>Estado</th><th>Entrada</th><th>Salida</th><th>Noches</th><th>Monto</th><th>Socio</th><th>Observaciones</th></tr></thead><tbody>'+filas+'</tbody></table><div class="total">Total ingresos: $'+total.toLocaleString('es-AR')+'</div>';
  const html = DOC_OPEN + DOC_STYLE + DOC_CLOSE + '</body></html>';

  const w = window.open('','_blank');
  w.document.write(html);
  w.document.close();
  w.print();
}

// ═══════════════════════════════════════════════════════════
//  CONFIGURACIÓN DE CABAÑAS
// ═══════════════════════════════════════════════════════════
function renderConfig() {
  const el = document.getElementById('panelConfig');
  if (!el) return;

  const filas = cabañasConfig.map((c, i) => `
    <tr>
      <td style="padding:10px 12px;font-weight:600;color:var(--text-muted);text-align:center;">${c.id}</td>
      <td style="padding:6px 8px;">
        <input type="text" value="${c.nombre}" id="cfg_nombre_${i}"
          onchange="cabañasConfig[${i}].nombre=this.value"
          style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--surface);color:var(--text);">
      </td>
      <td style="padding:6px 8px;">
        <input type="number" value="${c.tarifa||0}" id="cfg_tarifa_${i}" min="0" step="500"
          onchange="cabañasConfig[${i}].tarifa=Number(this.value)"
          placeholder="0"
          style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--surface);color:var(--text);">
      </td>
      <td style="padding:6px 8px;">
        <input type="number" value="${c.capacidad||0}" id="cfg_cap_${i}" min="0" max="20"
          onchange="cabañasConfig[${i}].capacidad=Number(this.value)"
          placeholder="0"
          style="width:80px;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--surface);color:var(--text);">
      </td>
      <td style="padding:6px 8px;">
        <input type="text" value="${c.descripcion||''}" id="cfg_desc_${i}"
          onchange="cabañasConfig[${i}].descripcion=this.value"
          placeholder="Opcional…"
          style="width:100%;padding:7px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--surface);color:var(--text);">
      </td>
    </tr>`).join('');

  el.innerHTML = `
    <div style="font-size:15px;font-weight:600;margin-bottom:1.25rem;">⚙️ Configuración de cabañas</div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;box-shadow:var(--shadow-sm);margin-bottom:1.5rem;">
       <div style="padding:10px 16px;background:var(--surface2);border-bottom:1px solid var(--border);font-size:13px;color:var(--text-muted);">
         Cambiá nombres, tarifas por noche y capacidad. Los cambios se guardan en la nube y se sincronizan automáticamente. Si modificás el nombre de una cabaña, actualizá también las reservas existentes.
       </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:var(--surface2);font-size:11px;text-transform:uppercase;color:var(--text-muted);">
              <th style="padding:8px 12px;text-align:center;min-width:40px;">#</th>
              <th style="padding:8px 12px;text-align:left;min-width:160px;">Nombre de la cabaña</th>
              <th style="padding:8px 12px;text-align:left;min-width:140px;">Tarifa por noche ($)</th>
              <th style="padding:8px 12px;text-align:left;min-width:110px;">Capacidad (pers.)</th>
              <th style="padding:8px 12px;text-align:left;min-width:200px;">Descripción</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn-primary" onclick="guardarConfig()">💾 Guardar configuración</button>
      <button class="btn-secondary" onclick="resetConfig()">↩️ Restaurar por defecto</button>
    </div>
    <div id="configMsg" style="margin-top:12px;display:none;padding:10px 14px;border-radius:8px;font-size:13px;"></div>
    <div style="margin-top:2rem;font-size:15px;font-weight:600;margin-bottom:1rem;">💰 Vista previa de tarifas</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;">
      ${cabañasConfig.map(c=>`
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:14px;text-align:center;box-shadow:var(--shadow-sm);">
          <div style="font-size:24px;font-weight:700;color:var(--primary);">${c.id}</div>
          <div style="font-size:13px;font-weight:600;margin:4px 0;">${c.nombre}</div>
          <div style="font-size:13px;color:#009e00;font-weight:600;">${c.tarifa>0?'$'+Number(c.tarifa).toLocaleString('es-AR')+' / noche':'Sin tarifa'}</div>
          ${c.capacidad>0?`<div style="font-size:11px;color:var(--text-muted);margin-top:3px;">👥 ${c.capacidad} personas</div>`:''}
          ${c.descripcion?`<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic;">${c.descripcion}</div>`:''}
        </div>`).join('')}
    </div>`;
}

function guardarConfig() {
  // Leer valores directamente del DOM para evitar problema de onchange
  cabañasConfig.forEach((c, i) => {
    const nombreEl = document.getElementById(`cfg_nombre_${i}`);
    const tarifaEl = document.getElementById(`cfg_tarifa_${i}`);
    const capEl = document.getElementById(`cfg_cap_${i}`);
    const descEl = document.getElementById(`cfg_desc_${i}`);
    if (nombreEl) c.nombre = nombreEl.value;
    if (tarifaEl) c.tarifa = Number(tarifaEl.value) || 0;
    if (capEl) c.capacidad = Number(capEl.value) || 0;
    if (descEl) c.descripcion = descEl.value;
  });
  
  guardarConfigCabañas();
  apiGuardarConfig();
  actualizarSelectoresCabaña();
  renderCalendario();
  renderDisponibilidad();
  const msg = document.getElementById('configMsg');
  if (msg) {
    msg.style.display = 'block';
    msg.style.background = 'var(--success-bg)';
    msg.style.color = 'var(--success)';
    msg.style.border = '1px solid var(--border-success)';
    msg.innerHTML = '✅ Configuración guardada. Calendario y selectores actualizados.';
    setTimeout(()=>{ msg.style.display='none'; }, 4000);
  }
  renderConfig();
}

function resetConfig() {
  if (!confirm('¿Restaurar todos los nombres a "Cabaña 1, 2, 3..."?\nLas tarifas también se borrarán.')) return;
  cabañasConfig = Array.from({length:8}, (_,i) => ({
    id: i+1, nombre: 'Cabaña '+(i+1), tarifa: 0, capacidad: 0, descripcion: ''
  }));
  guardarConfigCabañas();
  apiGuardarConfig();
  actualizarSelectoresCabaña();
  renderConfig();
}

async function apiGuardarConfig() {
  try {
    await fetch(API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'config', token: WRITE_TOKEN, config: cabañasConfig })
    });
  } catch (e) { console.error('Error guardando config:', e); }
}

function renderAll() {
  if (identidadSeleccionada || usuarioActual) {
    const modal = document.getElementById('idModal');
    modal.style.display = 'none';
    modal.style.pointerEvents = 'none';
    modal.style.visibility = 'hidden';
  }
  renderCalendario();
  renderListado();
  renderStats();
  renderDisponibilidad();
}

// ═══════════════════════════════════════════════════════════
//  MODO MANTENIMIENTO
// ═══════════════════════════════════════════════════════════
let modoMantenimiento = false;

function verificarMantenimiento() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('maint') === 'on') {
    activarMantenimiento(false);
    return true;
  }
  try {
    if (localStorage.getItem('cabanas_maint') === 'on') {
      activarMantenimiento(false);
      return true;
    }
  } catch(e) {}
  return false;
}

function activarMantenimiento(guardar = true) {
  modoMantenimiento = true;
  document.getElementById('maintOverlay').style.display = 'flex';
  if (guardar) {
    try { localStorage.setItem('cabanas_maint', 'on'); } catch(e) {}
  }
  const btn = document.getElementById('btnMaint');
  if (btn) { btn.textContent = '🔧 EN MANTENIMIENTO'; btn.classList.add('activo'); }
}

function desactivarMantenimiento() {
  modoMantenimiento = false;
  document.getElementById('maintOverlay').style.display = 'none';
  try { localStorage.removeItem('cabanas_maint'); } catch(e) {}
  const btn = document.getElementById('btnMaint');
  if (btn) { btn.textContent = '🔧 Mantenimiento'; btn.classList.remove('activo'); }
  cargarReservas();
}

async function toggleMantenimiento() {
  // V2-FIX#3: sin ADMIN_KEY en el cliente. El servidor autoriza por email
  // Google contra ADMIN_EMAILS. Si no sos admin, el servidor lo rechaza.
  if (!modoMantenimiento) {
    if (!confirm('¿Activar modo mantenimiento?\nLos socios dejarán de ver la app.')) return;
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'mantenimiento', token: WRITE_TOKEN, estado: true })
      });
      const data = await res.json();
      if (data.ok) {
        modoMantenimiento = true;
        adminSession = true;
        localStorage.setItem('admin_session', 'true');
        document.getElementById('adminMaintBanner').style.display = 'block';
        alert('✅ Mantenimiento activado. Los socios ya no podrán acceder.\nVos podés seguir trabajando normalmente.');
      } else {
        alert('Error al activar mantenimiento: ' + (data.error || 'Desconocido'));
      }
    } catch (e) {
      alert('Error de conexión al activar mantenimiento.');
      console.error(e);
    }
  } else {
    if (confirm('¿Desactivar el modo mantenimiento?\nLos socios volverán a ver la app normalmente.')) {
      await desactivarMantenimientoGlobal();
    }
  }
}

async function desactivarMantenimientoGlobal() {
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'mantenimiento', token: WRITE_TOKEN, estado: false })
    });
    const data = await res.json();
    if (data.ok) {
      modoMantenimiento = false;
      adminSession = false;
      localStorage.removeItem('admin_session');
      document.getElementById('adminMaintBanner').style.display = 'none';
      alert('✅ Mantenimiento desactivado. Los socios ya pueden acceder.');
      cargarReservas();
    } else {
      alert('Error al desactivar mantenimiento: ' + (data.error || 'Desconocido'));
    }
  } catch (e) {
    alert('Error de conexión al desactivar mantenimiento.');
    console.error(e);
  }
}

let logoClicks = 0;

function mostrarBotonMantenimiento() {
  const modalBtn = document.getElementById('btnMaintModal');
  const modal = document.getElementById('idModal');
  if (modal && modal.style.display !== 'none') {
    if (modalBtn) {
      modalBtn.style.display = modalBtn.style.display === 'none' || modalBtn.style.display === '' ? 'block' : 'none';
    }
  } else {
    const headerBtn = document.getElementById('btnMaint');
    if (headerBtn) {
      headerBtn.style.display = headerBtn.style.display === 'none' || headerBtn.style.display === '' ? 'block' : 'none';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const handleLogoClick = () => {
    logoClicks++;
    if (logoClicks >= 5) {
      logoClicks = 0;
      mostrarBotonMantenimiento();
    }
  };

  const logo = document.querySelector('.header-icon');
  if (logo) {
    logo.style.cursor = 'pointer';
    logo.addEventListener('click', handleLogoClick);
  }
  
  const modalLogo = document.querySelector('.modal-logo');
  if (modalLogo) {
    modalLogo.addEventListener('click', handleLogoClick);
  }
  
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'M') {
      e.preventDefault();
      mostrarBotonMantenimiento();
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
const now = new Date();
calYear = now.getFullYear(); calMonth = now.getMonth();

const savedUser = sessionStorage.getItem('usuario_actual');
if (savedUser) {
  usuarioActual = savedUser;
  identidadSeleccionada = true;
  document.getElementById('headerUsuario').innerHTML = '👤 ' + savedUser;
  document.getElementById('fSocio').value = savedUser;
  const disp = document.getElementById('socioDisplay');
  if (disp) disp.textContent = ' ' + savedUser;
  const modal = document.getElementById('idModal');
  modal.style.display = 'none';
  modal.style.pointerEvents = 'none';
  modal.style.visibility = 'hidden';
}

let syncInterval = null;

// V2-WIN#2: UN solo intervalo de sync (antes: 4 setInterval de 60s) +
// pausa cuando la pestaña está oculta + jitter ±15s anti-thundering-herd.
function syncDelay() {
  return 60000 + (Math.random() * 30000 - 15000);
}
function startSync() {
  if (syncInterval) return;
  const tick = () => {
    if (document.hidden) {
      syncInterval = setTimeout(tick, syncDelay());
      return;
    }
    cargarReservas();
    renderDisponibilidad();
    syncInterval = setTimeout(tick, syncDelay());
  };
  syncInterval = setTimeout(tick, syncDelay());
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && syncInterval) {
    cargarReservas();
    renderDisponibilidad();
  }
});

(async function init() {
  // Mostrar caché local inmediatamente si existe
  const cacheLocal = localStorage.getItem('reservas_cache');
  if (cacheLocal) {
    try {
      reservas = JSON.parse(cacheLocal);
    } catch(e) { localStorage.removeItem('reservas_cache'); }
  }
  
  document.getElementById('connectionBanner').style.display = 'block';
  document.getElementById('connectionBanner').textContent = cacheLocal ? 'Sincronizando...' : 'Conectando...';
  
  // Restaurar sesión de admin desde localStorage
  adminSession = localStorage.getItem('admin_session') === 'true';
  
  try {
    // V2-FIX#2: GET sin token (lectura pública mínima).
    const url = API_URL + '?t=' + Date.now();
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    const data = await res.json();

    if (data.ok && data.mantenimiento) {
      localStorage.removeItem('reservas_cache');
      document.getElementById('connectionBanner').style.display = 'none';

      // V2-FIX#3: admin server-side (email Google). Sin ADMIN_KEY en cliente:
      // si el servidor dice isAdmin, entra directo; si no, pantalla azul.
      adminSession = data.isAdmin === true;
      if (adminSession) {
        document.getElementById('adminMaintBanner').style.display = 'block';
        iniciarIdentidad();
        cargarReservas();
        startSync();
        return;
      }

      activarMantenimiento(false);
      return;
    }
    
    // Si NO hay mantenimiento, limpiar sesión admin
    if (data.ok && !data.mantenimiento) {
      localStorage.removeItem('cabanas_maint');
      if (adminSession) {
        adminSession = false;
        localStorage.removeItem('admin_session');
      }
      document.getElementById('adminMaintBanner').style.display = 'none';
    }
  } catch (e) {
    console.error('Error verificando mantenimiento global:', e);
    document.getElementById('connectionBanner').style.display = 'none';
    // Si no hay conexión pero hay caché, mostrar datos guardados
    if (reservas.length > 0) {
      iniciarIdentidad();
      renderAll();
      setSyncStatus('error', 'Sin conexión · mostrando datos guardados');
      return;
    }
    // Si no hay conexión pero sos admin, entrá igual
    if (adminSession) {
      document.getElementById('adminMaintBanner').style.display = 'block';
      iniciarIdentidad();
      cargarReservas();
          startSync();
      return;
    }
  }

  if (verificarMantenimiento()) {
    document.getElementById('connectionBanner').style.display = 'none';
    return;
  }

  iniciarIdentidad();
  cargarReservas();
      startSync();
})();

document.addEventListener('DOMContentLoaded', () => {
  const formCard = document.getElementById('formCard');
  if (!formCard) return;
  formCard.addEventListener('input',  () => { formularioActivo = true; setSyncStatus('ok', '⏸ Sync pausado'); });
  formCard.addEventListener('change', () => { formularioActivo = true; setSyncStatus('ok', '⏸ Sync pausado'); });
});
