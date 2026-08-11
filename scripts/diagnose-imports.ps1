param(
    [Parameter(Mandatory = $true)]
    [string]$Executable
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'env.ps1')

$resolvedExecutable = (Resolve-Path -LiteralPath $Executable).Path
$objectDump = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\mingw\ucrt64\bin') 'objdump.exe'
$dump = & $objectDump -p $resolvedExecutable
$imports = @{}
$currentLibrary = $null
foreach ($line in $dump) {
    if ($line -match '^\s*DLL Name:\s*(.+?)\s*$') {
        $currentLibrary = $Matches[1]
        if (-not $imports.ContainsKey($currentLibrary)) {
            $imports[$currentLibrary] = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        }
        continue
    }
    if ($line -match '^The Function Table') { break }
    if ($currentLibrary -and $line -match '^\s*[0-9a-f]+\s+<none>\s+[0-9a-f]+\s+(\S+)\s*$') {
        [void]$imports[$currentLibrary].Add($Matches[1])
    }
}

$searchFolders = @(
    (Split-Path -Parent $resolvedExecutable),
    (Join-Path $env:CARGO_TARGET_DIR 'debug'),
    "$env:SystemRoot\System32"
)
$searchFolders += $env:PATH.Split(';') | Where-Object { $_ }

$missingLibraries = @()
$missingProcedures = @()
foreach ($library in $imports.Keys) {
    $resolvedLibrary = $null
    foreach ($folder in $searchFolders) {
        $candidate = Join-Path $folder $library
        if (Test-Path -LiteralPath $candidate) {
            $resolvedLibrary = (Resolve-Path -LiteralPath $candidate).Path
            break
        }
    }
    if (-not $resolvedLibrary) {
        $missingLibraries += $library
        continue
    }

    $exportDump = & $objectDump -p $resolvedLibrary
    $exports = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in $exportDump) {
        if ($line -match '^\s*\[\s*\d+\]\s+\+base\[\s*\d+\]\s+[0-9a-f]+\s+(\S+)\s*$') {
            [void]$exports.Add($Matches[1])
        }
    }
    foreach ($procedure in $imports[$library]) {
        if (-not $exports.Contains($procedure)) {
            $missingProcedures += [pscustomobject]@{
                Library = $library
                Procedure = $procedure
                ResolvedPath = $resolvedLibrary
            }
        }
    }
}

Write-Host 'Missing libraries:'
$missingLibraries | Sort-Object
Write-Host 'Missing procedures:'
$missingProcedures | Sort-Object Library, Procedure | Format-Table -AutoSize
