# Downloads feedback files written by the app on the Mikrus server into Claude_Resources/Feedback.
# Usage: .\pull-feedback.ps1
param(
    [string]$Server = "wanda347.mikrus.xyz",
    [int]$SshPort = 10347,
    [string]$Key = "$HOME\.ssh\mikrus_planszowkarz"
)

$ErrorActionPreference = "Stop"
$target = "root@$Server"
$remoteDir = "/opt/planszowkarz/app/Claude_Resources/Feedback"
$localDir = Join-Path $PSScriptRoot "Claude_Resources\Feedback"
New-Item -ItemType Directory -Force $localDir | Out-Null

$sshArgs = @("-i", $Key, "-p", $SshPort, "-o", "StrictHostKeyChecking=accept-new")
$scpArgs = @("-i", $Key, "-P", $SshPort, "-o", "StrictHostKeyChecking=accept-new")

$remoteFiles = & ssh @sshArgs $target "ls -1 $remoteDir 2>/dev/null | grep '\.md$'"
if ($LASTEXITCODE -gt 1) { throw "Listing feedback on the server failed." }

# Only files not downloaded yet (names start with a timestamp, so they never change).
$newFiles = @($remoteFiles | Where-Object { $_ -and -not (Test-Path (Join-Path $localDir $_)) })
if ($newFiles.Count -eq 0) {
    Write-Host "Brak nowych uwag."
    return
}

# @() matters: splatting a single string would pass each character as a separate argument.
$sources = @($newFiles | ForEach-Object { "${target}:$remoteDir/$_" })
& scp @scpArgs @sources $localDir
if ($LASTEXITCODE -ne 0) { throw "Downloading feedback failed." }

Write-Host "Pobrano nowych uwag: $($newFiles.Count)"
$newFiles | ForEach-Object { Write-Host "  $_" }
