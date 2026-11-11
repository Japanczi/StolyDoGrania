# Planszówkarz

Sign-ups for board game tables ("Zapisy na gry"), live at https://planszowkarz.toadres.pl.

- **The app** (Node.js + TypeScript, Fastify, SQLite): [`node-app/`](node-app/). Run it locally from `node-app/`:
  `npm ci`, copy `.env.example` to `.env`, `npm run dev` → http://localhost:5180. Tests: `npm test`, `npm run test:e2e`.
- **Deploying** to the Mikrus server: `.\deploy.ps1` (see [`deploy/CUTOVER.md`](deploy/CUTOVER.md)).
- **Learning notes** (how the Node app works, compared with the .NET version): [`docs/learning/`](docs/learning/README.md).
- **The previous ASP.NET Core / Blazor version** is preserved on the `dotnet` branch.
