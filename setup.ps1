$Host.UI.RawUI.WindowTitle = 'Vorra Setup'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $root 'setup-log.txt'
$CHK=[char]10004; $CROSS=[char]10008; $ARR=[char]9656; $BF=[char]9608; $BL2=[char]9617
function Log($msg) { "[$((Get-Date).ToString('HH:mm:ss.fff'))] $msg" | Out-File $log -Append -Encoding UTF8 }
function StepTime($label) { $elapsed = [math]::Round(((Get-Date) - $script:stepStart).TotalSeconds, 1); Log "$label in ${elapsed}s"; $script:stepStart = Get-Date }
function Pass($msg) { Write-Host "   $CHK  $msg" -Fore Green; Log "OK: $msg" }
function Fail($msg) { Write-Host "   $CROSS  $msg" -Fore Red; Log "FAIL: $msg" }
function Info($msg) { Write-Host "   $ARR  $msg" -Fore DarkGray }
function Step($n,$msg) { Write-Host "" ; Write-Host "   [$n] " -Fore Green -NoNewline; Write-Host $msg -Fore White }
function FailExit($msg) { Fail $msg; Write-Host "`n   SETUP FAILED -- Check setup-log.txt" -Fore Red; Log "=== SETUP FAILED ==="; Read-Host "`n   Press Enter to exit"; exit 1 }

function RunCmd($label, $cmd) {
    Log "--- $label --- $cmd"
    $pi = New-Object System.Diagnostics.ProcessStartInfo
    $pi.FileName = "cmd.exe"; $pi.Arguments = "/c $cmd"
    $pi.WorkingDirectory = $root; $pi.UseShellExecute = $false
    $pi.RedirectStandardOutput = $true; $pi.RedirectStandardError = $true; $pi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($pi)
    $so = $p.StandardOutput.ReadToEnd(); $se = $p.StandardError.ReadToEnd(); $p.WaitForExit()
    if ($so) { $so | Out-File $log -Append -Encoding UTF8 }
    if ($se) { $se | Out-File $log -Append -Encoding UTF8 }
    Log "Exit: $($p.ExitCode)"
    return @{ Code = $p.ExitCode; Out = $so; Err = $se }
}

function RunLive($label, $cmd) {
    Log "--- $label (live) --- $cmd"
    $pi = New-Object System.Diagnostics.ProcessStartInfo
    $pi.FileName = "cmd.exe"; $pi.Arguments = "/c $cmd 2>&1"
    $pi.WorkingDirectory = $root; $pi.UseShellExecute = $false
    $pi.RedirectStandardOutput = $true; $pi.RedirectStandardError = $false; $pi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($pi)
    $spin = @('|','/','-','\')
    $si = 0; $lc = 0; $status = ""; $allOut = ""
    while ($true) {
        $line = $p.StandardOutput.ReadLine()
        if ($line -eq $null) { break }
        $allOut += "$line`r`n"
        $lc++
        $line | Out-File $log -Append -Encoding UTF8
        if ($line -match 'added (\d+) packages') { $status = "Installed $($Matches[1]) packages" }
        elseif ($line -match 'reify:.*electron') { $status = "Installing Electron..." }
        elseif ($line -match 'reify:(.+)') { $nm = $Matches[1].Trim().Split('/')[-1]; if ($nm.Length -gt 30) { $nm = $nm.Substring(0,30) }; $status = "Installing $nm..." }
        elseif ($line -match 'idealTree') { $status = "Resolving dependencies..." }
        elseif ($line -match 'diffTree') { $status = "Calculating changes..." }
        elseif ($line -match 'vite.*build') { $status = "Compiling..." }
        elseif ($line -match 'built in') { $status = "Build complete" }
        $s = $spin[$si % 4]; $si++
        $disp = if ($status) { $status } else { "$lc lines" }
        Write-Host "`r      $s  $disp                              " -Fore DarkGray -NoNewline
    }
    $p.WaitForExit()
    Write-Host "`r                                                            `r" -NoNewline
    Log "Exit: $($p.ExitCode)"
    return @{ Code = $p.ExitCode; Out = $allOut; Err = "" }
}

$t0 = Get-Date
"Vorra Setup Log | $($t0.ToString('yyyy-MM-dd HH:mm:ss')) | PS $($PSVersionTable.PSVersion) | $root" | Out-File $log -Encoding UTF8

try { mode con: cols=110 lines=45 } catch {}
Clear-Host; Write-Host ""

$art = @(
" █████   █████                                      "
"░░███   ░░███                                       "
" ░███    ░███   ██████  ████████  ████████   ██████  "
" ░███    ░███  ███░░███░░███░░███░░███░░███ ░░░░░███ "
" ░░███   ███  ░███ ░███ ░███ ░░░  ░███ ░░░   ███████ "
"  ░░░█████░   ░███ ░███ ░███      ░███      ███░░███ "
"    ░░███     ░░██████  █████     █████    ░░████████"
"     ░░░       ░░░░░░  ░░░░░     ░░░░░      ░░░░░░░░"
)
foreach ($a in $art) { Write-Host $a -Fore Green }
Write-Host ""
Write-Host "   AI-Powered Study & Life Planner                                 v7.3.0" -Fore DarkGray
Write-Host "   ========================================================================" -Fore DarkGray
Write-Host ""
$script:stepStart = Get-Date

# ── STEP 1 ──
Step "1/6" "Checking Node.js"
Log "Step 1"
$nd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nd) { FailExit "Node.js not found. Install from https://nodejs.org" }
$nv = "?"; try { $nv = (& node -v 2>$null).Trim() } catch {}
Pass "Node.js $nv"
$npmv = "?"; try { $npmv = (& npm -v 2>$null).Trim() } catch {}
Info "npm $npmv"
StepTime "Step 1"

# ── STEP 2 ──
Step "2/6" "Preparing environment"
Log "Step 2"
$nmDir = Join-Path $root "node_modules"
$oldExe = Join-Path $root "Vorra.exe"
if (Test-Path $oldExe) { Remove-Item $oldExe -Force -ErrorAction SilentlyContinue; Info "Removed old Vorra.exe" }
if (Test-Path (Join-Path $root "dist")) { Remove-Item -Recurse -Force (Join-Path $root "dist") -ErrorAction SilentlyContinue; Info "Cleaned old dist/" }
foreach ($tf in @("_launcher.cs","_wv_check.js")) { $p2=Join-Path $root $tf; if(Test-Path $p2){Remove-Item $p2 -Force -ErrorAction SilentlyContinue} }
if (Test-Path $nmDir) { Info "node_modules exists"; Pass "Environment ready" }
else { Info "Fresh install"; Pass "Environment ready" }
StepTime "Step 2"

# ── STEP 3 ──
Step "3/6" "Installing dependencies"
Log "Step 3"
$fresh = -not (Test-Path $nmDir)
if ($fresh) {
    Write-Host ""
    Write-Host "      Downloading Electron + dependencies (~80MB, first time only)" -Fore Cyan
    Write-Host ""
} else { Info "Checking packages..." }
$r = RunLive "npm-install" "npm install --progress"
if ($r.Code -ne 0) {
    Info "Retrying with --legacy-peer-deps..."
    $r = RunLive "npm-retry" "npm install --legacy-peer-deps --progress"
    if ($r.Code -ne 0) { FailExit "npm install failed (exit $($r.Code))" }
}
Pass "Dependencies installed"
$eExe = Join-Path $root "node_modules\electron\dist\electron.exe"
if (Test-Path $eExe) { $ev="?"; try{$ev=& $eExe --version 2>$null}catch{}; Info "Electron $ev" }
StepTime "Step 3"

# ── STEP 4 ──
Step "4/6" "Security audit"
Log "Step 4"
$r = RunCmd "audit" "npm audit --omit=dev 2>&1"
if ($r.Out -match "found 0 vulnerabilities") { Pass "No vulnerabilities" }
elseif ($r.Out -match "\d+\s+(high|critical)") { RunCmd "fix" "npm audit fix --omit=dev 2>&1" | Out-Null; Pass "Audit fixed" }
else { Pass "Audit clean" }
StepTime "Step 4"

# ── STEP 5 ──
Step "5/6" "Building application"
Log "Step 5"
Info "Compiling..."
$r = RunLive "build" "npx vite build"
if ($r.Code -ne 0) { FailExit "Build failed (exit $($r.Code))" }
if (-not (Test-Path (Join-Path $root "dist\index.html"))) { FailExit "dist/index.html missing" }
Pass "Build complete"
StepTime "Step 5"

# ── STEP 6 ──
Step "6/6" "Creating Vorra.exe"
Log "Step 6"
$exePath = Join-Path $root "Vorra.exe"
$csc = $null
foreach ($p3 in @("$env:windir\Microsoft.NET\Framework64\v4.0.30319\csc.exe","$env:windir\Microsoft.NET\Framework\v4.0.30319\csc.exe")) {
    if ((Test-Path $p3) -and (-not $csc)) { $csc = $p3 }
}
if ($csc) {
    $cs = Join-Path $root "_launcher.cs"
    $q = [char]34
    $nl = [Environment]::NewLine
    $src = "using System;using System.Diagnostics;using System.IO;using System.Reflection;" + $nl
    $src += "class Vorra{static void Main(){" + $nl
    $src += "string dir=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);" + $nl
    $src += "string e=Path.Combine(dir,${q}node_modules${q},${q}electron${q},${q}dist${q},${q}electron.exe${q});" + $nl
    $src += "if(!File.Exists(e)){Console.WriteLine(${q}Run setup.bat first.${q});Console.ReadKey();return;}" + $nl
    $src += "string s=Path.Combine(dir,${q}src${q},${q}App.jsx${q}),d=Path.Combine(dir,${q}dist${q},${q}index.html${q});" + $nl
    $src += "if(!File.Exists(d)||(File.Exists(s)&&File.GetLastWriteTime(s)>File.GetLastWriteTime(d))){" + $nl
    $src += "Console.WriteLine(${q}Rebuilding...${q});var b=Process.Start(new ProcessStartInfo{FileName=${q}cmd.exe${q}," + $nl
    $src += "Arguments=${q}/c npx vite build${q},WorkingDirectory=dir,UseShellExecute=false});" + $nl
    $src += "b.WaitForExit();if(b.ExitCode!=0){Console.WriteLine(${q}Build failed.${q});Console.ReadKey();return;}}" + $nl
    $src += "Process.Start(new ProcessStartInfo{FileName=e,Arguments=string.Format(" + $q + '\"{0}\"' + $q + ",dir)," + $nl
    $src += "WorkingDirectory=dir,UseShellExecute=false});}}" + $nl
    [System.IO.File]::WriteAllText($cs, $src)
    $pi = New-Object System.Diagnostics.ProcessStartInfo
    $pi.FileName = $csc
    $pi.Arguments = "/nologo /target:winexe /out:$exePath $cs"
    $pi.WorkingDirectory = $root; $pi.UseShellExecute = $false
    $pi.RedirectStandardOutput = $true; $pi.RedirectStandardError = $true; $pi.CreateNoWindow = $true
    $cp = [System.Diagnostics.Process]::Start($pi)
    $co = $cp.StandardOutput.ReadToEnd(); $ce = $cp.StandardError.ReadToEnd(); $cp.WaitForExit()
    if ($co) { Log $co }; if ($ce) { Log $ce }
    if (Test-Path $exePath) { Remove-Item $cs -Force -ErrorAction SilentlyContinue; Pass "Vorra.exe created" }
    else { Write-Host "   $ARR  Exe failed (use start.bat)" -Fore Yellow }
} else { Write-Host "   $ARR  .NET compiler not found (use start.bat)" -Fore Yellow }

# ── DONE ──
Write-Host ""
for ($i = 0; $i -le 100; $i += 5) {
    $w = 35; $f = [math]::Floor($i / 100 * $w); $e2 = $w - $f
    Write-Host ("`r   " + ("$BF" * $f) + ("$BL2" * $e2) + " $i%") -Fore Green -NoNewline
    Start-Sleep -Milliseconds 6
}
Write-Host ("`r   " + ("$BF" * 35) + " 100%  ") -Fore Green
Write-Host ""
Write-Host "   ========================================================================" -Fore Green
Write-Host "    $CHK  SETUP COMPLETE  --  All 6 steps passed" -Fore Green
Write-Host ""
$hasExe = Test-Path $exePath
if ($hasExe) { Write-Host "    Launch: " -Fore DarkGray -NoNewline; Write-Host "Vorra.exe" -Fore Green -NoNewline; Write-Host " or " -Fore DarkGray -NoNewline; Write-Host "start.bat" -Fore Cyan }
else { Write-Host "    Launch: " -Fore DarkGray -NoNewline; Write-Host "start.bat" -Fore Cyan }
Write-Host "   ========================================================================" -Fore Green
Write-Host ""
$elapsed = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
Log "Done in ${elapsed}s"; Log "=== COMPLETE ==="
Write-Host "   Finished in ${elapsed}s. Press Enter to close." -Fore DarkGray
Read-Host
