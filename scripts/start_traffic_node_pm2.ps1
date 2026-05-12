$ErrorActionPreference = 'Stop'

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$pm2Cmd = 'C:\Users\An JaeYeol\AppData\Roaming\npm\pm2.cmd'
$pm2Home = 'C:\Users\An JaeYeol\.pm2'
$logDir = Join-Path $projectRoot 'cache'
$logFile = Join-Path $logDir 'node_pm2_autostart.log'

$env:PM2_HOME = $pm2Home
$env:APPDATA = 'C:\Users\An JaeYeol\AppData\Roaming'
$env:Path = "C:\Program Files\nodejs;C:\Users\An JaeYeol\AppData\Roaming\npm;C:\Windows\System32;C:\Windows;$env:Path"

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Write-AutostartLog {
    param([string] $Level, [string] $Message)
    Add-Content -Path $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [$Level] $Message"
}

Write-AutostartLog 'INFO' 'Starting traffic-system PM2 autostart'

if (-not (Test-Path $pm2Cmd)) {
    Write-AutostartLog 'ERROR' "PM2 not found: $pm2Cmd"
    exit 9009
}

$serverPath = Join-Path $projectRoot 'server.js'
for ($attempt = 1; $attempt -le 60; $attempt++) {
    if (Test-Path $serverPath) {
        break
    }
    Start-Sleep -Seconds 2
}

if (-not (Test-Path $serverPath)) {
    Write-AutostartLog 'ERROR' "server.js not found: $serverPath"
    exit 2
}

Set-Location $projectRoot

Write-AutostartLog 'INFO' 'Starting or reloading traffic-system from current ecosystem.config.js'
& $pm2Cmd startOrReload ecosystem.config.js --update-env *>> $logFile

if ($LASTEXITCODE -ne 0) {
    Write-AutostartLog 'ERROR' "PM2 start/restart failed with code $LASTEXITCODE"
    exit $LASTEXITCODE
}

& $pm2Cmd save *>> $logFile
$exitCode = $LASTEXITCODE
Write-AutostartLog 'INFO' "PM2 autostart finished with code $exitCode"
exit $exitCode
