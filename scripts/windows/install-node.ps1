# Fetches the portable Node.js (the newest long-term release that has a build for this Windows) into
# %LOCALAPPDATA%\Capri\node, checks it against nodejs.org's own checksum, and adds it to the PATH of your
# account (yours only, no administrator). The folder with node.exe is the only thing printed on the output;
# what it says to you goes to the error stream. Used by start-capri.cmd when Node.js is missing or too old.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Say($text) { [Console]::Error.WriteLine($text) }

$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$kind = switch ($arch) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { 'x86' } }
$dest = Join-Path $env:LOCALAPPDATA 'Capri\node'

$index = Invoke-RestMethod -UseBasicParsing 'https://nodejs.org/dist/index.json'
$release = $index | Where-Object { $_.lts -and ($_.files -contains "win-$kind-zip") } | Select-Object -First 1
if (-not $release) { throw "nodejs.org has no Node.js for Windows $kind" }
$name = "node-$($release.version)-win-$kind.zip"
$base = "https://nodejs.org/dist/$($release.version)"
$zip = Join-Path $env:TEMP $name

Say "Скачиваю Node.js $($release.version) ($kind)..."
Invoke-WebRequest -UseBasicParsing "$base/$name" -OutFile $zip
$sums = (Invoke-WebRequest -UseBasicParsing "$base/SHASUMS256.txt").Content -split "`n"
$line = $sums | Where-Object { $_ -match ("\s" + [regex]::Escape($name) + "\s*$") } | Select-Object -First 1
if (-not $line) { throw "no checksum for $name" }
$want = ($line.Trim() -split '\s+')[0].ToLower()
$got = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
if ($got -ne $want) { Remove-Item $zip -Force; throw 'the downloaded file does not match its checksum' }

Say 'Распаковываю...'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Force $dest | Out-Null
Expand-Archive -Path $zip -DestinationPath $dest -Force
Remove-Item $zip -Force
$exe = Get-ChildItem $dest -Recurse -Filter node.exe | Select-Object -First 1
if (-not $exe) { throw 'node.exe was not found in the archive' }
$folder = $exe.DirectoryName

$user = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not (($user -split ';') -contains $folder)) {
  [Environment]::SetEnvironmentVariable('Path', ((($user + ';' + $folder) -replace '^;+', '') -replace ';{2,}', ';'), 'User')
  Say 'Добавила Node.js в PATH твоей учётной записи (новые окна терминала его увидят).'
}
Write-Output $folder
