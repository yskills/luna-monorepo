$ErrorActionPreference = 'SilentlyContinue'

$ports = @(5050, 5051, 5173, 5174, 4173)
$pidsToStop = New-Object System.Collections.Generic.HashSet[int]

foreach ($port in $ports) {
  try {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen
    foreach ($connection in $connections) {
      if ($connection.OwningProcess -and $connection.OwningProcess -gt 0) {
        [void]$pidsToStop.Add([int]$connection.OwningProcess)
      }
    }
  } catch {
    $lines = netstat -ano | Select-String ":$port"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
      if ($parts.Length -ge 5) {
            $processIdRaw = $parts[-1]
            if ($processIdRaw -match '^[0-9]+$') {
              [void]$pidsToStop.Add([int]$processIdRaw)
        }
      }
    }
  }
}

$wmip = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^(node|npm|powershell|pwsh)(\.exe)?$' -and (
    $_.CommandLine -match 'apps[\\/]assistant-service' -or
    $_.CommandLine -match 'apps[\\/]personal-luna' -or
    $_.CommandLine -match '(?:^|\s)vite(?:\.js)?(?:\s|$)' -or
    $_.CommandLine -match 'concurrently' -or
    $_.CommandLine -match 'dev:all' -or
    $_.CommandLine -match 'dev:web' -or
    $_.CommandLine -match 'dev:service'
  )
}

foreach ($proc in $wmip) {
  if ($proc.ProcessId -and $proc.ProcessId -gt 0) {
    [void]$pidsToStop.Add([int]$proc.ProcessId)
  }
}

foreach ($processId in $pidsToStop) {
  try {
    taskkill /PID $processId /T /F 2>$null | Out-Null
  } catch {
    try {
      Stop-Process -Id $processId -Force
    } catch {
    }
  }
}

exit 0
