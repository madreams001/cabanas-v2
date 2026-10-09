# ═══════════════════════════════════════════════════════════
#  DESPLEGAR V2 — Cabañas Catamarca
#  Build único → commit (solo fuentes, NUNCA generados ni secretos) →
#  push a GitHub (main, sin force) → clasp push (GAS backend)
#  El deploy a Pages lo hace el workflow pages.yml desde dist/.
#  Uso: .\desplegar.ps1
# ═══════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot

Write-Host ""
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  🚀 DESPLEGAR V2 — Cabañas Catamarca" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ── 1. Build único ──────────────────────────────────────────
Write-Host "📦 Paso 1: Build único (build → unificar → minify)..." -ForegroundColor Yellow
Set-Location $projectRoot
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error en el build. Abortando." -ForegroundColor Red
    exit 1
}
Write-Host ""

# ── 2. Git commit (solo fuentes) ────────────────────────────
Write-Host "📝 Paso 2: Commiteando fuentes a Git (sin generados)..." -ForegroundColor Yellow
Set-Location $projectRoot
git add src/ Codigo_AppScript.gs appsscript.json build.js unificar.js minify.js package.json vitest.config.js tests/ desplegar.ps1 .github/ .gitignore config.example.json README-V2.md
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    git commit -m "deploy: $timestamp"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Error en el commit. Abortando." -ForegroundColor Red
        exit 1
    }
    Write-Host "✅ Commit creado." -ForegroundColor Green
} else {
    Write-Host "⚠️  No hay cambios para commitear." -ForegroundColor Magenta
}

Write-Host ""

# ── 3. Push a GitHub (main, SIN force) ──────────────────────
Write-Host "📤 Paso 3: Pusheando a GitHub (main, sin force)..." -ForegroundColor Yellow
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error en el push a GitHub. Abortando." -ForegroundColor Red
    exit 1
}
Write-Host "✅ Push a main exitoso." -ForegroundColor Green
Write-Host "   ⏳ El workflow pages.yml deploya dist/ a Pages automáticamente." -ForegroundColor Yellow
Write-Host ""

# ── 4. Push a Google Apps Script ────────────────────────────
Write-Host "☁️  Paso 4: Pusheando a Google Apps Script..." -ForegroundColor Yellow
Set-Location $projectRoot
clasp push -f
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error en el push a Google Apps Script." -ForegroundColor Red
    Write-Host "   ¿Configuraste clasp? Ejecutá: clasp login (y poné el scriptId V2 en .clasp.json, gitignoreado)" -ForegroundColor Magenta
    exit 1
}
Write-Host "✅ Push a Google Apps Script exitoso." -ForegroundColor Green
Write-Host ""

# ── Resumen ───────────────────────────────────────────────────
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ✅ DESPLIEGUE V2 COMPLETADO" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "📋 Resumen:" -ForegroundColor White
Write-Host "   ✅ src/ + config.local.json → dist/index.html (minificado, artefacto único)" -ForegroundColor Green
Write-Host "   ✅ Solo fuentes commiteadas (generados y secretos gitignoreados)" -ForegroundColor Green
Write-Host "   ✅ Push a main sin force (Pages deploya solo)" -ForegroundColor Green
Write-Host "   ✅ Push a Google Apps Script (backend actualizado)" -ForegroundColor Green
Write-Host ""
Write-Host "⚠️  Backend modificado? Recordá hacer 'Nueva implementación' en GAS." -ForegroundColor Magenta
Write-Host "⚠️  NUNCA commitees config.local.json ni .clasp.json." -ForegroundColor Magenta
Write-Host ""
