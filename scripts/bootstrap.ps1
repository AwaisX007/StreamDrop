$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')

$rustup = Join-Path $env:CARGO_HOME 'bin\rustup.exe'
if (-not (Test-Path -LiteralPath $rustup)) {
    $rustupInstaller = Join-Path $env:TEMP 'rustup-init.exe'
    Write-Host 'Downloading the Rust installer into the workspace...'
    Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile $rustupInstaller
    & $rustupInstaller -y --no-modify-path --profile minimal --default-toolchain stable-gnu
    if ($LASTEXITCODE -ne 0) {
        throw "Rust installation failed with exit code $LASTEXITCODE"
    }
}

& $rustup toolchain install stable-gnu --profile minimal
if ($LASTEXITCODE -ne 0) {
    throw "The portable GNU Rust toolchain installation failed with exit code $LASTEXITCODE"
}

& (Join-Path $PSScriptRoot 'install-mingw.ps1')
if ($LASTEXITCODE -ne 0) {
    throw "The portable MinGW binutils installation failed with exit code $LASTEXITCODE"
}

Write-Host 'Installing frontend dependencies into the workspace...'
& npm.cmd install
if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
}

Write-Host 'Workspace-local toolchains are ready.'
Write-Host "Rust home: $env:RUSTUP_HOME"
Write-Host "Cargo home: $env:CARGO_HOME"
Write-Host "npm cache:  $env:npm_config_cache"
