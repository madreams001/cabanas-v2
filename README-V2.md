# Cabañas V2 — Andamio

Andamio nuevo del SaaS de reservas (Adriana, Federico, Jose), sin tocar V1.
Sin cambios de estética: solo seguridad, eficiencia y pipeline.

## Qué cambió vs V1

**Seguridad (nuevo modelo):**
- Sin secretos en código ni repo. `WRITE_TOKEN`, `ADMIN_EMAILS`, `SOCIO_EMAILS`
  y `SHEET_ID` viven solo en ScriptProperties del proyecto GAS.
- El frontend recibe `apiUrl` + `writeToken` en build-time desde
  `config.local.json` (gitignoreado; plantilla: `config.example.json`).
- GET sin token: solo lectura pública mínima. El token viaja solo en body POST.
- Roles en servidor: escritura verifica socio derivado del email Google
  (`SOCIO_EMAILS`); `config` y `mantenimiento` requieren email en `ADMIN_EMAILS`.
  Se eliminó `ADMIN_KEY` del cliente.
- GET devuelve proyección mínima (id, cabaña, fechas, estado, tipo, socio,
  noches) + agregados de finanzas calculados en servidor. PII (DNI, teléfono,
  email, dirección, monto, observaciones) ya no viaja al cliente.
  `NotaInterna` solo si el caller es admin.
- `esc()` aplicado en renders con datos de reservas + `<meta>` CSP restrictivo.
- Errores genéricos al cliente; detalle solo en logs (Stackdriver).
- `.gitignore` real: `config.local.json`, `.clasp.json`, generados
  (`dist/`, `style.html`, `script.html`, `index-gas.html`, etc.).

**Eficiencia:**
- Cache GAS 30s → 300s, guarda `{reservas, finanzas, config}` también en hit.
- Un solo timer de sync con `setTimeout` + jitter ±15s + pausa en pestaña oculta.
- Sin `aplicarEstilosFila` en el path crítico (usar formato condicional en el
  Sheet por columna Estado; la función queda solo para backfill manual).
- Build único `npm run build` (build → unificar → minify) + artefacto único
  `dist/index.html` (se eliminó el duplicado `index.min.html` vs `minis/`).
- Sonidos con `preload="none"` + guard `_lastKey` extendido a `renderCalendario`.

**Identidad:** el selector de socio sigue en el cliente solo como etiqueta
visual; el servidor ignora el socio del cliente y deriva el real del email
Google. Sin match → solo lectura.

## Pasos manuales de Cromi en Google (navegador)

1. **Crear proyecto GAS nuevo:** script.google.com → Nuevo proyecto →
   pegar `Codigo_AppScript.gs` + `appsscript.json` de esta carpeta.
2. **Copiar el Sheet:** abrir el Sheet V1 → Archivo → Hacer una copia
   (nombre: Reservas V2) → copiar el ID de la URL.
3. **Cargar secretos en ScriptProperties** (GAS → Configuración del proyecto →
   Propiedades de secuencia de comandos):
   - `SHEET_ID` = ID del Sheet V2
   - `WRITE_TOKEN` = token nuevo e inédito (ej. generador de contraseñas, 32+)
   - `ADMIN_EMAILS` = emails Google de los 3 socios, separados por coma
   - `SOCIO_EMAILS` = `{"email1":"Adriana","email2":"Federico","email3":"Jose"}`
4. **`clasp login` + scriptId nuevo:** en esta carpeta, `clasp login`, crear
   `.clasp.json` con el scriptId del proyecto NUEVO (está gitignoreado).
   Crear `config.local.json` desde `config.example.json` con la URL del
   WebApp V2 (paso 5) y el `WRITE_TOKEN`.
5. **Nueva implementación:** GAS → Implementar → Nueva implementación →
   tipo Aplicación web → Ejecutar como: yo → Acceso: Cualquiera →
   copiar la URL en `config.local.json` → `npm run build` → `clasp push`.
6. **Rotación:** en GAS del repo Pages, cargar `V2_API_URL` y `V2_WRITE_TOKEN`
   como secretos (Settings → Secrets → Actions) para el deploy automático.

## Plan de cutover V1 → V2

1. V2 operando en paralelo con su propio Sheet y secretos (pasos 1–5).
2. Verificar lectura/escritura V2 con un socio.
3. Congelar V1 (mantenimiento), migrar filas nuevas si las hubo.
4. Apuntar el frontend público a V2 y **rotar los secretos V1 DESPUÉS del
   cutover** (cambiar token en V1 o desactivar su WebApp) para que URLs
   viejas no sigan escribiendo.

## Rotación de secretos

Cambiar `WRITE_TOKEN` en ScriptProperties → actualizar `config.local.json`
local y el secreto `V2_WRITE_TOKEN` en GitHub → `npm run build` + Nueva
implementación en GAS si cambió el backend. Nunca commitear el valor.
