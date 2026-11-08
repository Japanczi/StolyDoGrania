# Builds Planszowkarz for Linux and deploys it to the Mikrus server.
# Usage: .\deploy.ps1            (build + deploy)
#        .\deploy.ps1 -Setup -AppPort 30347   (first time: prepare the server, then deploy)
param(
    [string]$Server = "wanda347.mikrus.xyz",
    [int]$SshPort = 10347,
    [string]$Key = "$HOME\.ssh\mikrus_planszowkarz",
    [switch]$Setup,
    [int]$AppPort = 0
)

$ErrorActionPreference = "Stop"
$target = "root@$Server"
$sshArgs = @("-i", $Key, "-p", $SshPort, "-o", "StrictHostKeyChecking=accept-new")
$scpArgs = @("-i", $Key, "-P", $SshPort, "-o", "StrictHostKeyChecking=accept-new")

function Invoke-Remote([string]$command) {
    & ssh @sshArgs $target $command
    if ($LASTEXITCODE -ne 0) { throw "Remote command failed: $command" }
}

if ($Setup) {
    if ($AppPort -le 0) { throw "-Setup needs -AppPort (one of your forwarded Mikrus ports)." }
    Write-Host "Preparing the server..."
    Invoke-Remote "mkdir -p /root/planszowkarz-setup"
    & scp @scpArgs deploy/planszowkarz.service deploy/planszowkarz.env.example deploy/server-setup.sh "${target}:/root/planszowkarz-setup/"
    if ($LASTEXITCODE -ne 0) { throw "Copying setup files failed." }
    Invoke-Remote "bash /root/planszowkarz-setup/server-setup.sh $AppPort"
}

Write-Host "Building..."
# Outside the project folder, so the output never gets picked up by the next build.
$publishDir = Join-Path $env:TEMP "planszowkarz-publish"
if (Test-Path $publishDir) { Remove-Item -Recurse -Force $publishDir }
dotnet publish "$PSScriptRoot\Planszowkarz.csproj" -c Release -r linux-x64 --self-contained -o $publishDir
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed." }

$package = Join-Path $env:TEMP "planszowkarz-deploy.tgz"
tar -czf $package -C $publishDir .
if ($LASTEXITCODE -ne 0) { throw "Packing failed." }

Write-Host "Uploading..."
& scp @scpArgs $package "${target}:/root/planszowkarz-deploy.tgz"
if ($LASTEXITCODE -ne 0) { throw "Upload failed." }

# Replace the app files but keep Claude_Resources (feedback files written by the app) and the data folder.
Write-Host "Installing and restarting..."
Invoke-Remote ("systemctl stop planszowkarz; " +
    "find /opt/planszowkarz/app -mindepth 1 -maxdepth 1 ! -name Claude_Resources -exec rm -rf {} + && " +
    "tar -xzf /root/planszowkarz-deploy.tgz -C /opt/planszowkarz/app && " +
    "chmod +x /opt/planszowkarz/app/Planszowkarz && rm /root/planszowkarz-deploy.tgz && " +
    "systemctl start planszowkarz && sleep 5 && systemctl is-active planszowkarz")

Remove-Item $package
Write-Host "Deployed."
