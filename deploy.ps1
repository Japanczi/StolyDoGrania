# Deploys the Node version of Planszowkarz to the Mikrus server.
# Usage: .\deploy.ps1                                   (build + deploy)
#        .\deploy.ps1 -Setup -AppPort 30347            (first time: prepare the server, then deploy)
# The .NET version lives on the `dotnet` branch; its service ("planszowkarz") and files stay on the server, stopped,
# so switching back stays possible (deploy/CUTOVER.md).
param(
    [string]$Server = "wanda347.mikrus.xyz",
    [int]$SshPort = 10347,
    [string]$Key = "$HOME\.ssh\mikrus_planszowkarz",
    [switch]$Setup,
    [int]$AppPort = 0,
    # Same Node version as on the PC (node-app/.nvmrc names the major version).
    [string]$NodeVersion = "26.13.0"
)

$ErrorActionPreference = "Stop"
$target = "root@$Server"
$sshArgs = @("-i", $Key, "-p", $SshPort, "-o", "StrictHostKeyChecking=accept-new")
$scpArgs = @("-i", $Key, "-P", $SshPort, "-o", "StrictHostKeyChecking=accept-new")

function Invoke-Remote([string]$command) {
    # Remote messages go to stdout: PowerShell 5.1 turns any stderr line into a fatal error under "Stop".
    & ssh @sshArgs $target "exec 2>&1; $command"
    if ($LASTEXITCODE -ne 0) { throw "Remote command failed: $command" }
}

if ($Setup) {
    if ($AppPort -le 0) { throw "-Setup needs -AppPort (one of your forwarded Mikrus ports)." }
    Write-Host "Preparing the server..."
    Invoke-Remote "mkdir -p /root/planszowkarz-setup"
    & scp @scpArgs deploy/planszowkarz-node.service deploy/server-setup-node.sh deploy/convert-env.sh "${target}:/root/planszowkarz-setup/"
    if ($LASTEXITCODE -ne 0) { throw "Copying setup files failed." }
    Invoke-Remote "bash /root/planszowkarz-setup/server-setup-node.sh $AppPort $NodeVersion"
}

Write-Host "Building..."
# No compile step (Node runs the .ts files): the package is the source plus production packages only.
# better-sqlite3 ships its Linux binary inside the package, so installing on Windows works for Linux too.
$stage = Join-Path $env:TEMP "planszowkarz-node-deploy"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory $stage | Out-Null
$app = Join-Path $PSScriptRoot "node-app"
foreach ($item in @("src", "public", "scripts", "package.json", "package-lock.json", ".nvmrc")) {
    Copy-Item -Recurse (Join-Path $app $item) $stage
}
# The server-side database conversion (deploy/CUTOVER.md) travels with the app.
New-Item -ItemType Directory (Join-Path $stage "deploy") | Out-Null
Copy-Item (Join-Path $PSScriptRoot "deploy\convert-live-db.sh") (Join-Path $stage "deploy")
Push-Location $stage
try {
    npm ci --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }
} finally {
    Pop-Location
}

$package = Join-Path $env:TEMP "planszowkarz-node-deploy.tgz"
# GNU tar from Git for Windows: Windows' own tar.exe (bsdtar) crashed on this folder (2026-11-11).
# Run from the stage folder with a relative output path, so the drive letter's ":" never reaches tar.
$gitBin = Join-Path (Split-Path (Split-Path (Get-Command git).Source)) "usr\bin"
$savedPath = $env:Path
$env:Path = "$gitBin;$env:Path"   # tar calls gzip from the same folder
Push-Location $stage
try {
    & (Join-Path $gitBin "tar.exe") --owner=0 --group=0 -czf "../planszowkarz-node-deploy.tgz" .
    if ($LASTEXITCODE -ne 0) { throw "Packing failed." }
} finally {
    Pop-Location
    $env:Path = $savedPath
}

Write-Host "Uploading..."
& scp @scpArgs $package "${target}:/root/planszowkarz-node-deploy.tgz"
if ($LASTEXITCODE -ne 0) { throw "Upload failed." }

# Replace the app files (no data lives there), apply migrations, restart, and check /health.
Write-Host "Installing and restarting..."
Invoke-Remote ("set -e; ENV=/opt/planszowkarz/planszowkarz-node.env; " +
    "systemctl stop planszowkarz-node 2>/dev/null || true; " +
    "find /opt/planszowkarz/node -mindepth 1 -maxdepth 1 -exec rm -rf {} +; " +
    "tar --no-same-owner -xzf /root/planszowkarz-node-deploy.tgz -C /opt/planszowkarz/node && rm /root/planszowkarz-node-deploy.tgz; " +
    "cd /opt/planszowkarz/node && /opt/node/bin/node --env-file=`$ENV src/db/migrate.ts; " +
    "systemctl enable planszowkarz-node >/dev/null; systemctl start planszowkarz-node; sleep 3; " +
    "systemctl is-active planszowkarz-node; " +
    "curl -fsS http://127.0.0.1:`$(grep '^PORT=' `$ENV | cut -d= -f2)/health; echo")

Remove-Item $package
Write-Host "Deployed."
