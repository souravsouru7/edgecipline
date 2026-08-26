<#
    Runs one load level end to end and leaves behind a comparable artifact set.

    For every level it:
      1. Flushes the load-test Redis keyspace (db 3) so each level starts from
         the same cold-cache state — otherwise level N would inherit level N-1's
         warm analytics cache and look artificially fast.
      2. Starts the resource sampler alongside k6.
      3. Runs the scenario and exports the k6 summary as JSON.

    Usage:
      powershell -File tests/performance/scripts/run-level.ps1 -Vus 25 -Duration 1m
      powershell -File tests/performance/scripts/run-level.ps1 -Scenario stress -Label stress-300
#>

param(
    [int]$Vus = 10,
    [string]$Duration = "1m",
    [string]$Scenario = "load-step",
    [string]$Label = "",
    [string]$BaseUrl = "http://127.0.0.1:5001",
    [int]$MonitorSeconds = 0,
    [switch]$NoFlush
)

$ErrorActionPreference = "Continue"

$K6 = "C:\Users\souta\k6tool\k6-v2.2.0-windows-amd64\k6.exe"
$PerfDir = Split-Path -Parent $PSScriptRoot
Set-Location $PerfDir

if (-not $Label) { $Label = "$Scenario-${Vus}vu" }
$resultsDir = Join-Path $PerfDir "results"
if (-not (Test-Path $resultsDir)) { New-Item -ItemType Directory -Force -Path $resultsDir | Out-Null }

$summaryFile  = "results/$Label.json"
$resourceFile = "results/$Label-resources.csv"
$consoleFile  = "results/$Label-console.txt"

# 1. Cold-cache reset -------------------------------------------------------
if (-not $NoFlush) {
    $redisCli = Get-Command redis-cli -ErrorAction SilentlyContinue
    if ($redisCli) {
        & redis-cli -n 3 FLUSHDB | Out-Null
        Write-Host "Flushed Redis db 3 (cold cache)."
    } else {
        # No redis-cli on PATH — use the backend's ioredis instead.
        $flush = @"
const path=require('path');
const IORedis=require(path.join('C:/Users/souta/Desktop/new/stratedge/backend/node_modules','ioredis'));
const c=new IORedis('redis://127.0.0.1:6379/3');
c.flushdb().then(()=>{console.log('Flushed Redis db 3 (cold cache).');return c.quit();}).catch(e=>{console.error(e.message);process.exit(1);});
"@
        $flush | & node -
    }
}

# 2. Resource sampler -------------------------------------------------------
if ($MonitorSeconds -le 0) {
    # Cover ramp + hold + a little slack.
    $MonitorSeconds = 40
    if ($Duration -match '^(\d+)m$') { $MonitorSeconds = [int]$Matches[1] * 60 + 60 }
    elseif ($Duration -match '^(\d+)s$') { $MonitorSeconds = [int]$Matches[1] + 60 }
}

$monitorOut = Join-Path $PerfDir "results\$Label-monitor.log"
$monitorAbs = Join-Path $PerfDir $resourceFile.Replace("/", "\")

$monitor = Start-Process -FilePath "powershell" `
    -ArgumentList "-NoProfile","-File","$PSScriptRoot\monitor-resources.ps1","-DurationSeconds","$MonitorSeconds","-OutFile","$monitorAbs" `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $monitorOut -RedirectStandardError "$monitorOut.err"

# 3. k6 ---------------------------------------------------------------------
$env:BASE_URL   = $BaseUrl
$env:TARGET_VUS = "$Vus"
$env:DURATION   = $Duration

Write-Host "=== $Label : $Vus VUs for $Duration ==="
& $K6 run --summary-export="$summaryFile" "scenarios/$Scenario.js" 2>&1 | Tee-Object -FilePath $consoleFile | Select-String -Pattern "business_errors|err_|lat_|http_req|iterations\.|user_journ|vus_max|rate_limited|server_errors|request_timeouts|checks_"

# The sampler writes its CSV only at the very end. If this script exits first,
# the process tree is torn down and the whole run's resource data is lost — so
# wait for it to finish, generously, rather than assuming it beat k6.
if (-not $monitor.HasExited) {
    Wait-Process -Id $monitor.Id -Timeout ($MonitorSeconds + 120) -ErrorAction SilentlyContinue
}
if (-not (Test-Path $monitorAbs)) {
    Write-Warning "Resource CSV missing: $monitorAbs (sampler may have been killed early)"
}

Write-Host "Artifacts: $summaryFile, $resourceFile, $consoleFile"
