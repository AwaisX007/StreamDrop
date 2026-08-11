$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')

& npm.cmd run check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Push-Location (Join-Path (Get-Location) 'src-tauri')
try {
    & cargo test
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}

