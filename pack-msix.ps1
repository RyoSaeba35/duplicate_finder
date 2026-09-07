$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Push-Location "$root\src-tauri"
cargo tauri build
Pop-Location

$exe = "$root\src-tauri\target\release\Duplicate Finder.exe"
if (-not (Test-Path $exe)) { throw "Exe introuvable : $exe" }

$dist = "$root\dist"
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
Copy-Item $exe $dist -Force

winapp pack "$dist" --cert "$root\devcert.pfx"
