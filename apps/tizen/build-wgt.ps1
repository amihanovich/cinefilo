# Empaqueta y firma Miru.wgt (app de Samsung Tizen).
#
# Por qué un script y no `tizen package -- .` a secas: el empaquetador mete en
# el .wgt TODO lo que encuentre en el directorio, incluidos README.md y este
# mismo script. Acá armamos un staging con los 3 archivos que la app necesita
# de verdad y empaquetamos desde ahí.
#
# Requisitos (ver README.md): CLI de Tizen instalado y un perfil de firma.
# Uso:  .\build-wgt.ps1            (o con -Profile OtroPerfil)

param(
  [string]$SigningProfile = "MiruProfile",
  [string]$TizenRoot      = "$env:USERPROFILE\tizen-studio",
  [string]$JavaHome       = "C:\Program Files\Android\Android Studio\jbr"
)

$ErrorActionPreference = "Stop"
$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$staging = Join-Path $here "_wgt-staging"
$tizen   = Join-Path $TizenRoot "tools\ide\bin\tizen.bat"

if (-not (Test-Path $tizen)) { throw "No encuentro el CLI de Tizen en $tizen — ver README.md" }

# El CLI es de la era Java 8: sin este --add-exports, un JDK moderno corta el
# acceso a la clase interna de xerces que usa para leer el perfil de firma.
$env:JAVA_HOME = $JavaHome
$env:PATH = "$JavaHome\bin;$env:PATH"
$env:JAVA_TOOL_OPTIONS = "--add-exports=java.xml/com.sun.org.apache.xerces.internal.impl.dv.util=ALL-UNNAMED"

# Solo estos 3 archivos son la app. Todo lo demás (README, scripts, .wgt viejos)
# se queda afuera.
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null
foreach ($f in @("config.xml", "index.html", "icon.png")) {
  Copy-Item (Join-Path $here $f) $staging
}

& $tizen package -t wgt -s $SigningProfile -- $staging
if ($LASTEXITCODE -ne 0) { throw "tizen package falló (exit $LASTEXITCODE)" }

$out = Join-Path $here "Miru.wgt"
Move-Item -Force (Join-Path $staging "Miru.wgt") $out
Remove-Item -Recurse -Force $staging

# Un .wgt sin estas dos firmas no lo acepta ningún TV — es la diferencia entre
# un entregable y un zip inútil, así que lo verificamos siempre.
$names = (& "$env:JAVA_HOME\bin\jar.exe" tf $out) -join "`n"
foreach ($sig in @("author-signature.xml", "signature1.xml")) {
  if ($names -notmatch [regex]::Escape($sig)) { throw "El .wgt salió SIN $sig — no está firmado." }
}

$size = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Output ""
Write-Output "OK  $out  ($size KB, firmado)"
Write-Output "Instalar:  sdb connect <ip-tv>:26101  &&  tizen install -n Miru.wgt -t <device-id>"
