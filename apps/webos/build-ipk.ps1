# Empaqueta com.miru.tv_<version>_all.ipk (app de LG webOS).
#
# A diferencia de Tizen, webOS NO firma el paquete: para modo desarrollador el
# .ipk va tal cual. Por eso acá no hay certificados ni perfiles — solo empaquetar.
#
# Requisitos (ver README.md): `npm i -g @webosose/ares-cli` (o pasar -AresBin).
# Uso:  .\build-ipk.ps1

param(
  # Por defecto usa el ares-package que esté en el PATH.
  [string]$AresBin = "ares-package"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# El empaquetador se lleva TODO lo que haya en el directorio, así que sacamos
# explícitamente lo que no es la app (docs, este script, .ipk de corridas
# anteriores). Mismo criterio que el staging de apps/tizen/build-wgt.ps1.
$excludes = @("README.md", "build-ipk.ps1", "*.ipk")
$args = @($here, "-o", $here)
foreach ($e in $excludes) { $args += @("-e", $e) }

& $AresBin @args
if ($LASTEXITCODE -ne 0) { throw "ares-package falló (exit $LASTEXITCODE)" }

$ipk = Get-ChildItem $here -Filter "*.ipk" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $ipk) { throw "No se generó ningún .ipk" }

# Chequeo de que adentro viajen los 4 archivos de la app y nada más: el .ipk es
# un archivo "ar" (formato Debian), así que leemos su data.tar.gz.
$node = @'
const fs=require("fs"),zlib=require("zlib");
const b=fs.readFileSync(process.argv[1]); let o=8, names=[];
while(o<b.length){
  const name=b.toString("ascii",o,o+16).trim();
  const size=parseInt(b.toString("ascii",o+48,o+58).trim(),10);
  if(name.startsWith("data.tar.gz")){
    const t=zlib.gunzipSync(b.slice(o+60,o+60+size));
    for(let p=0;p<t.length;p+=512){
      const n=t.toString("ascii",p,p+100).replace(/\0.*$/,"");
      if(!n) break;
      const sz=parseInt(t.toString("ascii",p+124,p+136).replace(/\0.*$/,"").trim(),8)||0;
      if(sz>0) names.push(n.split("/").pop());
      p+=Math.ceil(sz/512)*512;
    }
  }
  o+=60+size+(size%2);
}
console.log(names.join(","));
'@
$inside = (node -e $node $ipk.FullName).Trim()
foreach ($need in @("appinfo.json", "index.html", "icon.png", "largeIcon.png")) {
  if ($inside -notmatch [regex]::Escape($need)) { throw "El .ipk salió SIN $need (contiene: $inside)" }
}
foreach ($bad in @("README.md", "build-ipk.ps1")) {
  if ($inside -match [regex]::Escape($bad)) { throw "El .ipk incluye $bad — revisá los -e/--app-exclude" }
}

$size = [math]::Round($ipk.Length / 1KB, 1)
Write-Output ""
Write-Output "OK  $($ipk.FullName)  ($size KB)"
Write-Output "Instalar:  ares-setup-device  &&  ares-install $($ipk.Name) -d <device>"
