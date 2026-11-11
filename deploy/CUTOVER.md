# Switching the public site from .NET to Node (and back)

Server: `wanda347.mikrus.xyz` (SSH port 10347, key `~/.ssh/mikrus_planszowkarz`). Public address
`https://planszowkarz.toadres.pl` → forwarded port **30347**. Free port **20347** (`https://srv72-20347.wykr.es`).

| | .NET (old) | Node (new) |
|---|---|---|
| Code | branch `dotnet` | `master` |
| Files | `/opt/planszowkarz/app` | `/opt/planszowkarz/node` (+ Node itself in `/opt/node`) |
| Service | `planszowkarz` | `planszowkarz-node` |
| Settings | `/opt/planszowkarz/planszowkarz.env` | `/opt/planszowkarz/planszowkarz-node.env` (made from the .NET one by `convert-env.sh`) |
| Database | `/opt/planszowkarz/data/app.db` | `/opt/planszowkarz/data/planszowkarz.db` (converted copy) |
| Feedback files | `/opt/planszowkarz/app/Claude_Resources/Feedback` | the same folder (`pull-feedback.ps1` unchanged) |

Nothing of the .NET app is deleted: its files, service, settings and database stay, so switching back is quick.

## 1. Trial run beside the .NET app (port 20347)

From the project folder on the PC (PowerShell):

```bash
.\deploy.ps1 -Setup -AppPort 20347
```

Installs Node in `/opt/node` (official build, checksum verified), creates the Node settings file from the .NET one
(secrets copied on the server, never printed), installs the service, uploads the app and starts it on 20347.
On the server, convert a fresh copy of the live database and restart:

```bash
systemctl stop planszowkarz-node && bash /opt/planszowkarz/node/deploy/convert-live-db.sh && systemctl start planszowkarz-node
```

Check `https://srv72-20347.wykr.es` (log in, board, live updates, Baza gier, admin pages) while `.NET` still serves the
public address.

## 2. Switch (a few minutes of downtime)

```bash
systemctl stop planszowkarz planszowkarz-node
```

```bash
bash /opt/planszowkarz/node/deploy/convert-live-db.sh
```

```bash
sed -i 's/^PORT=.*/PORT=30347/' /opt/planszowkarz/planszowkarz-node.env && systemctl disable planszowkarz && systemctl enable --now planszowkarz-node
```

The conversion copies everything users did in .NET up to the stop. Everyone is logged out once (new cookies);
passwords stay the same.

## 3. Switch back to .NET

```bash
systemctl disable --now planszowkarz-node && systemctl enable --now planszowkarz
```

The .NET app continues from its own database as it was at the switch: changes made in the Node app after the switch
are not in it (they stay in `planszowkarz.db`). To try Node again later, set its `PORT` back to 20347 first.

## Backups

Every conversion leaves the copy it converted in `/opt/planszowkarz/backup/app-<time>.db`, and moves any Node database
it replaces to `/opt/planszowkarz/backup/planszowkarz-replaced-<time>.db`.
