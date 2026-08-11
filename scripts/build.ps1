$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')

& npm.cmd run build
exit $LASTEXITCODE

