$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')

if (-not (Test-Path -LiteralPath (Join-Path $env:CARGO_HOME 'bin\cargo.exe'))) {
    throw 'Rust is not bootstrapped. Run .\scripts\bootstrap.ps1 first.'
}
if (-not (Test-Path -LiteralPath (Join-Path (Get-Location) 'node_modules'))) {
    throw 'Frontend dependencies are not installed. Run .\scripts\bootstrap.ps1 first.'
}

& npm.cmd run dev
exit $LASTEXITCODE

