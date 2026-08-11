$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')

$assembler = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\mingw\ucrt64\bin\as.exe'
$destination = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\mingw'
$selfContainedBin = Join-Path $env:RUSTUP_HOME 'toolchains\stable-x86_64-pc-windows-gnu\lib\rustlib\x86_64-pc-windows-gnu\bin\self-contained'
$embeddedAssembler = Join-Path $selfContainedBin 'as.exe'

if (Test-Path -LiteralPath $embeddedAssembler) {
    & $embeddedAssembler --version 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'Portable MinGW binutils are already available.'
        exit 0
    }
}

$packages = @(
    @{
        Name = 'binutils'
        Url = 'https://mirror.msys2.org/mingw/ucrt64/mingw-w64-ucrt-x86_64-binutils-2.47-1-any.pkg.tar.zst'
        Sha256 = 'c28d432cfd251840df4da4245fed2898aef8f7008fc100ff7e085f1b4c3d872d'
    },
    @{
        Name = 'gettext-runtime'
        Url = 'https://mirror.msys2.org/mingw/ucrt64/mingw-w64-ucrt-x86_64-gettext-runtime-1.0-1-any.pkg.tar.zst'
        Sha256 = 'ba693dda4ac375af76ce481ff3a6e7481286546cc7dc6d56c7021dae34084157'
    },
    @{
        Name = 'libiconv'
        Url = 'https://mirror.msys2.org/mingw/ucrt64/mingw-w64-ucrt-x86_64-libiconv-1.19-1-any.pkg.tar.zst'
        Sha256 = '9a500f38c2b91808741c62fae746b3e9110b33a1ecf5c30fa0c66dbedddf7e16'
    },
    @{
        Name = 'zlib'
        Url = 'https://mirror.msys2.org/mingw/ucrt64/mingw-w64-ucrt-x86_64-zlib-1.3.2-2-any.pkg.tar.zst'
        Sha256 = '841401182976d2f9e17e5c0ebaac51f2a8014140ea53d67625e91c8fb3c85ea0'
    },
    @{
        Name = 'zstd'
        Url = 'https://mirror.msys2.org/mingw/ucrt64/mingw-w64-ucrt-x86_64-zstd-1.5.7-2-any.pkg.tar.zst'
        Sha256 = 'dbdb8427280046a2b41697780aa4c52983b708082b0da4755951dc3bea96ca89'
    }
)

New-Item -ItemType Directory -Force -Path $destination | Out-Null
foreach ($package in $packages) {
    $archive = Join-Path $env:TEMP "streamdrop-mingw-$($package.Name).pkg.tar.zst"
    Write-Host "Downloading portable MinGW $($package.Name) into the workspace..."
    Invoke-WebRequest -Uri $package.Url -OutFile $archive
    $actualSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualSha256 -ne $package.Sha256) {
        Remove-Item -LiteralPath $archive -Force
        throw "The portable MinGW $($package.Name) checksum did not match the official MSYS2 package."
    }
    & tar.exe -xf $archive -C $destination
    if ($LASTEXITCODE -ne 0) {
        throw "Could not extract portable MinGW $($package.Name) (exit code $LASTEXITCODE)"
    }
}

if (-not (Test-Path -LiteralPath $assembler)) {
    throw 'The portable MinGW package did not contain the expected assembler.'
}
& $assembler --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'The portable MinGW assembler could not start after its dependencies were installed.'
}

# Rust's GNU host ships a deliberately minimal linker that invokes an assembler
# beside its own dlltool. Keep the missing assembler and its runtime DLLs in the
# same workspace-local toolchain directory so no machine-wide MinGW install is
# required.
New-Item -ItemType Directory -Force -Path $selfContainedBin | Out-Null
$runtimeFiles = @('as.exe', 'libintl-8.dll', 'libiconv-2.dll', 'libcharset-1.dll', 'libzstd.dll', 'zlib1.dll')
foreach ($runtimeFile in $runtimeFiles) {
    $source = Join-Path $destination "ucrt64\bin\$runtimeFile"
    if (-not (Test-Path -LiteralPath $source)) {
        throw "The portable MinGW packages did not contain $runtimeFile."
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $selfContainedBin $runtimeFile) -Force
}
& $embeddedAssembler --version | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'The workspace-local Rust assembler integration could not start.'
}

Write-Host 'Portable MinGW binutils are ready.'
