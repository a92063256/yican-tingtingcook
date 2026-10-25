param([int]$Port = 3000)
$ErrorActionPreference = 'Stop'
$nodePath = (& node -p 'process.execPath').Trim()
$ruleName = "Yican-LAN-$Port"
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js was not found.' }
# No login in this testing edition; restrict inbound connections to the local subnet.
# Both network profiles are supported because the current home adapter is marked Public.
if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
  Write-Host "Firewall rule already exists: $ruleName"
} else {
  New-NetFirewallRule -Name $ruleName -DisplayName "Yican LAN TCP $Port (local subnet only)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet -Profile Any -Program $nodePath | Out-Null
  Write-Host "Allowed TCP $Port for Node.js from the local subnet only."
}
