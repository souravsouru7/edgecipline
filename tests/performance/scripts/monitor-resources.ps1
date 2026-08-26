<#
    Samples host and per-process resource usage during a k6 run and writes CSV.

    Tracks the three processes that matter for this stack — the API (node),
    MongoDB (mongod) and Redis — plus the k6 load generator and system-wide
    available memory, so k6 latency numbers can be correlated with what the
    backend was actually doing.

    CPU is read from Win32_PerfFormattedData_PerfProc_Process rather than
    Get-Process().TotalProcessorTime: mongod runs as a Windows service under a
    different account, and TotalProcessorTime is silently unreadable there —
    which produces a convincing but entirely false "MongoDB is idle" reading.
    The perf counter is readable across accounts.

    CPU values are Windows "% Processor Time": 100 = one fully saturated
    logical core, so an 8-core box tops out near 800.

    Usage:
      powershell -File tests/performance/scripts/monitor-resources.ps1 `
        -DurationSeconds 120 -OutFile results/resources-50vu.csv
#>

param(
    [int]$DurationSeconds = 120,
    [int]$IntervalSeconds = 2,
    [string]$OutFile = "resources.csv",
    [int]$ApiPid = 0
)

$ErrorActionPreference = "SilentlyContinue"

# Resolve the API process: prefer an explicit PID, otherwise find whatever is
# listening on the load-test port.
if ($ApiPid -eq 0) {
    $conn = Get-NetTCPConnection -LocalPort 5001 -State Listen | Select-Object -First 1
    if ($conn) { $ApiPid = $conn.OwningProcess }
}

$cpuCount = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors

$rows = @()
$samples = [math]::Floor($DurationSeconds / $IntervalSeconds)

Write-Host "Sampling for $DurationSeconds s (API pid=$ApiPid, $cpuCount logical CPUs) -> $OutFile"

for ($i = 0; $i -lt $samples; $i++) {
    $ts = (Get-Date).ToString("HH:mm:ss")

    # One perf snapshot per interval, indexed by PID.
    $perf = @{}
    Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
        Where-Object { $_.IDProcess -gt 0 } |
        ForEach-Object { $perf[[int]$_.IDProcess] = $_ }

    $mongoProc = Get-Process -Name mongod        | Select-Object -First 1
    $redisProc = Get-Process -Name "redis-server" | Select-Object -First 1
    $k6Proc    = Get-Process -Name k6            | Select-Object -First 1

    function Stat($proc, $pidOverride) {
        $procId = if ($pidOverride) { $pidOverride } elseif ($proc) { $proc.Id } else { 0 }
        if ($procId -eq 0) { return @{ Cpu = 0; Mem = 0; Threads = 0; Handles = 0 } }
        $p = $perf[[int]$procId]
        if (-not $p) { return @{ Cpu = 0; Mem = 0; Threads = 0; Handles = 0 } }
        return @{
            Cpu     = [math]::Round([double]$p.PercentProcessorTime, 1)
            Mem     = [math]::Round([double]$p.WorkingSetPrivate / 1MB, 1)
            Threads = [int]$p.ThreadCount
            Handles = [int]$p.HandleCount
        }
    }

    $api   = Stat $null      $ApiPid
    $mongo = Stat $mongoProc $null
    $redis = Stat $redisProc $null
    $k6    = Stat $k6Proc    $null

    $availMb = (Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue

    $rows += [PSCustomObject]@{
        Time           = $ts
        ApiCpuPct      = $api.Cpu
        ApiMemMB       = $api.Mem
        ApiThreads     = $api.Threads
        ApiHandles     = $api.Handles
        MongoCpuPct    = $mongo.Cpu
        MongoMemMB     = $mongo.Mem
        RedisCpuPct    = $redis.Cpu
        RedisMemMB     = $redis.Mem
        K6CpuPct       = $k6.Cpu
        K6MemMB        = $k6.Mem
        SysAvailableMB = [math]::Round($availMb, 0)
    }

    Start-Sleep -Seconds $IntervalSeconds
}

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$rows | Export-Csv -Path $OutFile -NoTypeInformation -Encoding utf8
Write-Host "Wrote $($rows.Count) samples to $OutFile"

foreach ($col in "ApiCpuPct", "MongoCpuPct", "RedisCpuPct", "K6CpuPct") {
    $m = $rows | Measure-Object -Property $col -Maximum -Average
    Write-Host ("{0,-12} peak={1,7} mean={2,7}   (100 = one core of {3})" -f $col, [math]::Round($m.Maximum,1), [math]::Round($m.Average,1), $cpuCount)
}
$mm = $rows | Measure-Object -Property ApiMemMB -Maximum
Write-Host ("ApiMemMB     peak={0} MB" -f [math]::Round($mm.Maximum,1))
$av = $rows | Measure-Object -Property SysAvailableMB -Minimum
Write-Host ("System available memory low-water mark = {0} MB" -f $av.Minimum)
