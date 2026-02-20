$ErrorActionPreference = 'SilentlyContinue'

$ports = @(5050, 5051, 5173)

foreach ($port in $ports) {
  try {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen
    foreach ($connection in $connections) {
      if ($connection.OwningProcess -and $connection.OwningProcess -gt 0) {
        Stop-Process -Id $connection.OwningProcess -Force
      }
    }
  } catch {
    $lines = netstat -ano | Select-String ":$port"
    foreach ($line in $lines) {
      $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' }
      if ($parts.Length -ge 5) {
        $pid = $parts[-1]
        if ($pid -match '^[0-9]+$') {
          Stop-Process -Id ([int]$pid) -Force
        }
      }
    }
  }
}

exit 0
