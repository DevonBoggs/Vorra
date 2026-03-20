$Host.UI.RawUI.WindowTitle = 'DevonSYNC'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $root 'start-log.txt'
$CHK=[char]10004; $CROSS=[char]10008; $BF=[char]9608; $BL2=[char]9617

function Log($msg) { "[$((Get-Date).ToString('HH:mm:ss.fff'))] $msg" | Out-File $log -Append -Encoding UTF8 }
function Pass($msg) { Write-Host "   $CHK  $msg" -Fore Green; Log "OK: $msg" }
function Fail($msg) { Write-Host "   $CROSS  $msg" -Fore Red; Log "FAIL: $msg" }

function WriteGradient($text) { Write-Host $text -Fore Green }

"[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Quick Start`r`nRoot: $root" | Out-File $log -Encoding UTF8
try { mode con: cols=115 lines=30 } catch {}
Clear-Host; Write-Host ""

$artLines = @(
" ██████████                                             █████████  █████ █████ ██████   █████   █████████ ",
"░░███░░░░███                                           ███░░░░░███░░███ ░░███ ░░██████ ░░███   ███░░░░░███",
" ░███   ░░███  ██████  █████ █████  ██████  ████████  ░███    ░░░  ░░███ ███   ░███░███ ░███  ███     ░░░ ",
" ░███    ░███ ███░░███░░███ ░░███  ███░░███░░███░░███ ░░█████████   ░░█████    ░███░░███░███ ░███         ",
" ░███    ░███░███████  ░███  ░███ ░███ ░███ ░███ ░███  ░░░░░░░░███   ░░███     ░███ ░░██████ ░███         ",
" ░███    ███ ░███░░░   ░░███ ███  ░███ ░███ ░███ ░███  ███    ░███    ░███     ░███  ░░█████ ░░███     ███",
" ██████████  ░░██████   ░░█████   ░░██████  ████ █████░░█████████     █████    █████  ░░█████ ░░█████████ ",
"░░░░░░░░░░    ░░░░░░     ░░░░░     ░░░░░░  ░░░░ ░░░░░  ░░░░░░░░░     ░░░░░    ░░░░░    ░░░░░   ░░░░░░░░░"
)
foreach ($line in $artLines) { WriteGradient $line }
Write-Host ""
Write-Host "   WGU AI Study Planner                                            v7.3.0" -Fore DarkGray
Write-Host "   ========================================================================" -Fore DarkGray
Write-Host ""

$electronExe = Join-Path $root "node_modules\electron\dist\electron.exe"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js not found - run setup.bat"; Read-Host "   Enter to exit"; exit 1 }
Pass "Node.js $((& node -v 2>$null).Trim())"
if (-not (Test-Path $electronExe)) { Fail "Dependencies missing - run setup.bat"; Read-Host "   Enter to exit"; exit 1 }
Pass "Electron"

$distF = Join-Path $root "dist\index.html"; $srcF = Join-Path $root "src\App.jsx"
$rebuild = (-not (Test-Path $distF)) -or ((Test-Path $srcF) -and (Test-Path $distF) -and ((Get-Item $srcF).LastWriteTime -gt (Get-Item $distF).LastWriteTime))
if ($rebuild) {
    Write-Host "   !  Build outdated - rebuilding..." -Fore Yellow; Log "Rebuilding"
    $pi = New-Object System.Diagnostics.ProcessStartInfo
    $pi.FileName = "cmd.exe"; $pi.Arguments = "/c npx vite build"
    $pi.WorkingDirectory = $root; $pi.UseShellExecute = $false
    $pi.RedirectStandardOutput = $true; $pi.RedirectStandardError = $true; $pi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($pi)
    $p.StandardOutput.ReadToEnd() | Out-File $log -Append -Encoding UTF8
    $p.StandardError.ReadToEnd() | Out-File $log -Append -Encoding UTF8
    $p.WaitForExit()
    if ($p.ExitCode -ne 0) { Fail "Build failed"; Read-Host "   Enter"; exit 1 }
    Pass "Rebuilt"
} else { Pass "Build current" }

Write-Host ""
$sp = @([char]10251,[char]10265,[char]10297,[char]10296,[char]10300,[char]10292,[char]10278,[char]10279,[char]10247,[char]10255)
for ($r=0;$r -lt 2;$r++) { foreach ($f in $sp) {
    Write-Host "`r   $f  Starting DevonSYNC..." -Fore Magenta -NoNewline; Start-Sleep -Milliseconds 50
}}
Write-Host "`r   $CHK  Launching!              " -Fore Green
Write-Host ""
Write-Host "   ========================================================================" -Fore Green
Write-Host "    $CHK  All checks passed" -Fore Green
Write-Host "   ========================================================================" -Fore Green
Write-Host ""

Log "Launching"
Start-Process -FilePath $electronExe -ArgumentList "`"$root`""

for ($i = 3; $i -ge 1; $i--) {
    Write-Host "`r   Closing in $i...  " -Fore DarkGray -NoNewline; Start-Sleep 1
}
Write-Host ""
