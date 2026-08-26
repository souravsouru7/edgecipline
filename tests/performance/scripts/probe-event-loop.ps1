<#
    Event-loop saturation probe.

    GET /health is served entirely from synchronous in-memory state: a mongoose
    readyState integer, a Redis status string and a counters object. It performs
    NO database query, NO Redis command and NO disk I/O.

    Therefore its response time under load is almost entirely:
        network (loopback, ~0) + time waiting to be scheduled on the event loop.

    If /health stays fast while business endpoints slow down, the bottleneck is
    downstream (MongoDB, Redis, external calls). If /health degrades in lockstep
    with everything else, the Node.js event loop itself is the constraint.

    Usage:
      powershell -File scripts/probe-event-loop.ps1 -DurationSeconds 60 -OutFile results/probe.csv
#>

param(
    [int]$DurationSeconds = 60,
    [int]$IntervalMs = 250,
    [string]$Url = "http://127.0.0.1:5001/health",
    [string]$OutFile = "results/event-loop-probe.csv"
)

$ErrorActionPreference = "SilentlyContinue"
$deadline = (Get-Date).AddSeconds($DurationSeconds)
$rows = @()

while ((Get-Date) -lt $deadline) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $status = 0
    try {
        $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30
        $status = $resp.StatusCode
    } catch {
        $status = -1
    }
    $sw.Stop()

    $rows += [PSCustomObject]@{
        Time      = (Get-Date).ToString("HH:mm:ss.fff")
        LatencyMs = [math]::Round($sw.Elapsed.TotalMilliseconds, 2)
        Status    = $status
    }
    Start-Sleep -Milliseconds $IntervalMs
}

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$rows | Export-Csv -Path $OutFile -NoTypeInformation -Encoding utf8

$lat = $rows | Where-Object { $_.Status -gt 0 } | Select-Object -ExpandProperty LatencyMs | Sort-Object
if ($lat.Count -gt 0) {
    function Pct($sorted, $p) { return $sorted[[math]::Min($sorted.Count - 1, [math]::Floor($sorted.Count * $p))] }
    Write-Host ("/health samples={0}  min={1}ms  med={2}ms  p90={3}ms  p95={4}ms  max={5}ms" -f `
        $lat.Count, $lat[0], (Pct $lat 0.5), (Pct $lat 0.9), (Pct $lat 0.95), $lat[$lat.Count - 1])
} else {
    Write-Host "No successful /health samples."
}
