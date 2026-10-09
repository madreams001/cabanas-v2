const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function ds(y, m, d) {
  return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

function normalizarFecha(val) {
  if (!val) return '';
  const s = val.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  return s;
}

function fmtFecha(s) {
  if (!s || s.length < 10) return s || '—';
  const [y, m, d_] = s.substring(0, 10).split('-');
  return (d_ || '?') + '-' + (m || '?') + '-' + (y || '?');
}

function nombreCabaña(config, n) {
  const cfg = config.find(c => c.id === n);
  return cfg ? cfg.nombre : 'Cabaña ' + n;
}

function tarifaCabaña(config, nombreBuscado) {
  const cfg = config.find(c => c.nombre === nombreBuscado);
  return cfg ? cfg.tarifa : 0;
}

function crearConfigDefault() {
  return Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    nombre: 'Cabaña ' + (i + 1),
    tarifa: 0,
    capacidad: 0,
    descripcion: ''
  }));
}

function detectarConflictos(reservas, cab, ent, sal, excludeId) {
  return reservas.filter(r =>
    r.Cabaña === cab &&
    ent < r.Salida &&
    sal > r.Entrada &&
    ent !== r.Salida &&
    (excludeId == null || r.ID.toString() !== excludeId.toString())
  );
}

function getReservaEn(reservas, cab, dStr) {
  const entrante = reservas.find(r => r.Cabaña === cab && r.Entrada === dStr);
  if (entrante) return entrante;
  return reservas.find(r => r.Cabaña === cab && dStr >= r.Entrada && dStr <= r.Salida);
}

function calcularStats(reservas, todayS) {
  const ocupadas = reservas.filter(r => r.Estado === 'Ocupada' && r.Salida >= todayS).length;
  const confirmadas = reservas.filter(r => r.Estado === 'Confirmada' && r.Salida >= todayS).length;
  const noConfirmadas = reservas.filter(r => r.Estado === 'No confirmada' && r.Salida >= todayS).length;
  return {
    ocupadas,
    confirmadas,
    noConfirmadas,
    total: reservas.length,
    ingresos: reservas.reduce((s, r) => s + (Number(r.Monto) || 0), 0)
  };
}

function calcularFinanzas(reservas) {
  const porMes = {};
  const porCabaña = {};
  const porSocio = {};

  reservas.forEach(r => {
    const monto = Number(r.Monto) || 0;
    const mes = (r.Entrada || '').substring(0, 7);
    const cab = r.Cabaña || '—';
    const socio = r.Socio || '—';

    if (!porMes[mes])    porMes[mes]    = { total: 0, count: 0 };
    if (!porCabaña[cab]) porCabaña[cab] = { total: 0, count: 0 };
    if (!porSocio[socio])porSocio[socio]= { total: 0, count: 0 };

    porMes[mes].total    += monto; porMes[mes].count++;
    porCabaña[cab].total += monto; porCabaña[cab].count++;
    porSocio[socio].total+= monto; porSocio[socio].count++;
  });

  return {
    porMes,
    porCabaña,
    porSocio,
    total: reservas.reduce((s, r) => s + (Number(r.Monto) || 0), 0)
  };
}

function obtenerAlertasProximas(reservas, fechas) {
  return reservas.filter(r => fechas.includes(r.Entrada));
}

function calcularCalendario(reservas, config, calYear, calMonth) {
  const dim = new Date(calYear, calMonth + 1, 0).getDate();
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

  return { dim, resMap };
}

function filtrarReservas(reservas, filtros) {
  let lista = [...reservas];
  if (filtros.cab)     lista = lista.filter(r => r.Cabaña === filtros.cab);
  if (filtros.estado)  lista = lista.filter(r => r.Estado === filtros.estado);
  if (filtros.tipo)    lista = lista.filter(r => r.Tipo === filtros.tipo);
  if (filtros.socio)   lista = lista.filter(r => r.Socio === filtros.socio);
  if (filtros.mes)     lista = lista.filter(r => (r.Entrada||'').startsWith(filtros.mes) || (r.Salida||'').startsWith(filtros.mes));
  if (filtros.buscar)  {
    const q = filtros.buscar.toLowerCase().trim();
    lista = lista.filter(r =>
      (r.Nombre||'').toLowerCase().includes(q) ||
      (r.DNI_CUIT||'').toLowerCase().includes(q)
    );
  }
  return lista;
}

function ordenarReservas(lista, criterio) {
  const arr = [...lista];
  arr.sort((a, b) => {
    const numA = parseInt((a.Cabaña||'').replace(/\D/g,'')) || 0;
    const numB = parseInt((b.Cabaña||'').replace(/\D/g,'')) || 0;

    if (!criterio) {
      if (numA !== numB) return numA - numB;
      return a.Entrada < b.Entrada ? -1 : 1;
    }
    switch (criterio) {
      case 'mes':
        return a.Entrada < b.Entrada ? -1 : a.Entrada > b.Entrada ? 1 : 0;
      case 'cab-asc':     return numA - numB;
      case 'cab-desc':    return numB - numA;
      case 'nombre-asc':  return (a.Nombre||'').localeCompare(b.Nombre||'');
      case 'nombre-desc': return (b.Nombre||'').localeCompare(a.Nombre||'');
      case 'socio-asc':   return (a.Socio||'').localeCompare(b.Socio||'');
      case 'fecha-asc':   return a.Entrada < b.Entrada ? -1 : a.Entrada > b.Entrada ? 1 : 0;
      case 'fecha-desc':  return b.Entrada < a.Entrada ? -1 : b.Entrada > a.Entrada ? 1 : 0;
      default:            return 0;
    }
  });
  return arr;
}

function agruparPorMes(lista) {
  const grupos = {};
  lista.forEach(r => {
    const mes = (r.Entrada||'').substring(0, 7);
    if (!grupos[mes]) grupos[mes] = [];
    grupos[mes].push(r);
  });
  return grupos;
}

function exportCSVData(reservas) {
  if (!reservas.length) return '';
  const cols = ['Cabaña','Tipo','Estado','Nombre','DNI_CUIT','Telefono','Email','Direccion','Entrada','Salida','Noches','Pago','Monto','Observaciones','Socio','Cargada'];
  const rows = reservas.map(r => cols.map(c => `"${(r[c]||'').toString().replace(/"/g,'""')}"`).join(','));
  return [cols.join(','), ...rows].join('\n');
}

const logicApi = {
  MESES,
  ds,
  normalizarFecha,
  fmtFecha,
  nombreCabaña,
  tarifaCabaña,
  crearConfigDefault,
  detectarConflictos,
  getReservaEn,
  calcularStats,
  calcularFinanzas,
  obtenerAlertasProximas,
  calcularCalendario,
  filtrarReservas,
  ordenarReservas,
  agruparPorMes,
  exportCSVData,
};

// Export dual-mode:
//  - Node (tests): module.exports
//  - Navegador (vía build.js): window.Logic
if (typeof module !== 'undefined' && module.exports) {
  module.exports = logicApi;
} else if (typeof window !== 'undefined') {
  window.Logic = logicApi;
}
