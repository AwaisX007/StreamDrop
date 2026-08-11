$ErrorActionPreference = 'Stop'

$streamdropRoot = Split-Path -Parent $PSScriptRoot
$localTools = Join-Path $streamdropRoot 'tools'
$localTemp = Join-Path $streamdropRoot '.tmp'
$localCargo = Join-Path $localTools 'cargo'
$localRustup = Join-Path $localTools 'rustup'

@(
    $localTools,
    $localTemp,
    $localCargo,
    $localRustup,
    (Join-Path $localTools 'npm-cache'),
    (Join-Path $localTools 'npm-global'),
    (Join-Path $streamdropRoot 'bin'),
    (Join-Path $streamdropRoot 'data')
) | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
}

$env:CARGO_HOME = $localCargo
$env:RUSTUP_HOME = $localRustup
$env:RUSTUP_TOOLCHAIN = 'stable-gnu'
$env:CARGO_TARGET_DIR = Join-Path $streamdropRoot 'src-tauri\target'
$env:npm_config_cache = Join-Path $localTools 'npm-cache'
$env:npm_config_prefix = Join-Path $localTools 'npm-global'
$env:npm_config_update_notifier = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_audit = 'false'
$env:TEMP = $localTemp
$env:TMP = $localTemp
$env:STREAMDROP_BIN_DIR = Join-Path $streamdropRoot 'bin'
$env:STREAMDROP_DATA_DIR = Join-Path $streamdropRoot 'data'
$gnuToolchainBin = Join-Path $localRustup 'toolchains\stable-x86_64-pc-windows-gnu\bin'
$gnuSelfContainedBin = Join-Path $localRustup 'toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained'
$mingwBin = Join-Path $localTools 'mingw\ucrt64\bin'
$targetDebugBin = Join-Path $env:CARGO_TARGET_DIR 'debug'
$env:PATH = "$targetDebugBin;$PSScriptRoot;$localCargo\bin;$gnuToolchainBin;$gnuSelfContainedBin;$mingwBin;$env:PATH"

Set-Location $streamdropRoot
