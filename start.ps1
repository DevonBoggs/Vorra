$Host.UI.RawUI.WindowTitle = 'Vorra'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $root 'start-log.txt'
$CHK=[char]10004; $CROSS=[char]10008; $BF=[char]9608; $BL2=[char]9617

function Log($msg) { "[$((Get-Date).ToString('HH:mm:ss.fff'))] $msg" | Out-File $log -Append -Encoding UTF8 }
function Pass($msg) { Write-Host "   $CHK  $msg" -Fore Green; Log "OK: $msg" }
function Fail($msg) { Write-Host "   $CROSS  $msg" -Fore Red; Log "FAIL: $msg" }

function WriteGradient($text) { Write-Host $text -Fore Green }

"[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Quick Start`r`nRoot: $root" | Out-File $log -Encoding UTF8

# Read version from package.json (single source of truth)
$appVersion = "?"
try {
    $pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
    $appVersion = $pkg.version
} catch { $appVersion = "?" }

try { mode con: cols=115 lines=30 } catch {}
Clear-Host; Write-Host ""

$artLines = @(
" █████   █████                                      ",
"░░███   ░░███                                       ",
" ░███    ░███   ██████  ████████  ████████   ██████  ",
" ░███    ░███  ███░░███░░███░░███░░███░░███ ░░░░░███ ",
" ░░███   ███  ░███ ░███ ░███ ░░░  ░███ ░░░   ███████ ",
"  ░░░█████░   ░███ ░███ ░███      ░███      ███░░███ ",
"    ░░███     ░░██████  █████     █████    ░░████████",
"     ░░░       ░░░░░░  ░░░░░     ░░░░░      ░░░░░░░░"
)
foreach ($line in $artLines) { WriteGradient $line }
Write-Host ""
Write-Host "   AI-Powered Study & Life Planner                                 v$appVersion" -Fore DarkGray
Write-Host "   ========================================================================" -Fore DarkGray
Write-Host ""

$electronExe = Join-Path $root "node_modules\electron\dist\electron.exe"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js not found - run setup.bat"; Read-Host "   Enter to exit"; exit 1 }
Pass "Node.js $((& node -v 2>$null).Trim())"
if (-not (Test-Path $electronExe)) { Fail "Dependencies missing - run setup.bat"; Read-Host "   Enter to exit"; exit 1 }
Pass "Electron"

# Non-blocking check for available updates
try {
    $gitCheck = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCheck -and (Test-Path (Join-Path $root ".git"))) {
        $fetch = & git -C $root fetch --dry-run 2>&1
        if ($fetch) { Write-Host "   !  Updates may be available — run: git pull && setup.bat" -Fore Yellow; Log "Updates available" }
    }
} catch {}

$distF = Join-Path $root "dist\index.html"
$rebuild = -not (Test-Path $distF)
if (-not $rebuild) {
    $distTime = (Get-Item $distF).LastWriteTime
    # Check if ANY source file is newer than the build
    $newerSrc = Get-ChildItem -Path (Join-Path $root "src") -Recurse -File | Where-Object { $_.LastWriteTime -gt $distTime } | Select-Object -First 1
    if ($newerSrc) { $rebuild = $true }
    # Also check electron/ and index.html
    $newerElectron = Get-ChildItem -Path (Join-Path $root "electron") -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $distTime } | Select-Object -First 1
    if ($newerElectron) { $rebuild = $true }
    $indexHtml = Join-Path $root "index.html"
    if ((Test-Path $indexHtml) -and ((Get-Item $indexHtml).LastWriteTime -gt $distTime)) { $rebuild = $true }
}
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
    Write-Host "`r   $f  Starting Vorra..." -Fore Magenta -NoNewline; Start-Sleep -Milliseconds 50
}}
Write-Host "`r   $CHK  Launching!              " -Fore Green
Write-Host ""
Write-Host "   ========================================================================" -Fore Green
Write-Host "    $CHK  All checks passed" -Fore Green
Write-Host "   ========================================================================" -Fore Green
Write-Host ""

Log "Launching"
Start-Process -FilePath $electronExe -ArgumentList "`"$root`"" -WindowStyle Normal

# Hide the console window immediately after launch
try {
    Add-Type -Name Win32 -Namespace Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();'
    $hwnd = [Native.Win32]::GetConsoleWindow()
    if ($hwnd -ne [IntPtr]::Zero) { [Native.Win32]::ShowWindow($hwnd, 0) | Out-Null }
} catch {}

# Brief delay to ensure Electron process is started, then exit cleanly
Start-Sleep -Milliseconds 500
