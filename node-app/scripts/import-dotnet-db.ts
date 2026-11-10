// One-time conversion of the .NET app's database (app.db: EF Core + ASP.NET Identity tables) into the Node app's
// schema. Run at cutover (phase 5); tried in phase 4 on a local copy. Usage, from node-app/:
//
//   node scripts/import-dotnet-db.ts <path to app.db copy> <new database file>
//
// The source is opened read-only; the target must not exist yet. Everything is copied in ONE transaction, so a
// failure leaves no half-filled database. Existing ids are kept (users, games, tables, phrases, log entries), so
// action-log entries and feedback files (userId:) still point at the right users. Passwords stay as ASP.NET
// Identity v3 hashes and are re-hashed with scrypt at each user's next login.

import { existsSync } from 'node:fs';
import SqliteDatabase from 'better-sqlite3';
import { openDatabase, type Db } from '../src/db/database.ts';
import { migrateToLatest } from '../src/db/migrator.ts';
import type { Role } from '../src/db/schema.ts';
import type { TableKind } from '../src/domain/play-table.ts';
import { normalizeKey } from '../src/domain/user-name.ts';

type Row = Record<string, unknown>;

export type ConversionReport = {
  counts: Record<string, number>;
  /** Accounts that had two-factor authentication on: they lose it (2FA is not in v1, brief section 4). */
  twoFactorUsers: string[];
  /** Notes about data that had to be adjusted. */
  warnings: string[];
};

/** Copies everything from an open .NET database into a freshly migrated Node database. */
export async function convertDotnetDb(source: SqliteDatabase.Database, target: Db, now: Date = new Date()): Promise<ConversionReport> {
  const all = (sql: string): Row[] => source.prepare(sql).all() as Row[];
  const report: ConversionReport = { counts: {}, twoFactorUsers: [], warnings: [] };

  // ---------- users and roles ----------
  const roles = new Map<string, Set<string>>();
  for (const r of all('select ur.UserId as userId, r.Name as role from AspNetUserRoles ur join AspNetRoles r on r.Id = ur.RoleId')) {
    const set = roles.get(String(r.userId)) ?? new Set<string>();
    set.add(String(r.role));
    roles.set(String(r.userId), set);
  }
  // AppRoles.MainRole: Owner, then Admin, otherwise User – the app only ever used the highest role.
  const mainRole = (userId: string): Role => {
    const set = roles.get(userId);
    return set?.has('Owner') ? 'owner' : set?.has('Admin') ? 'admin' : 'user';
  };
  const users = all('select * from AspNetUsers');
  const userIds = new Set(users.map(u => String(u.Id)));
  const userOrNull = (id: unknown, what: string): string | null => {
    if (id === null || id === undefined) return null;
    if (userIds.has(String(id))) return String(id);
    // .NET had no foreign key here, so a seat could point at a deleted account; the Node app keeps the seat without it.
    report.warnings.push(`${what}: unknown user id ${String(id)} cleared.`);
    return null;
  };

  await target.transaction().execute(async trx => {
    for (const u of users) {
      const userName = String(u.UserName ?? '');
      const email = String(u.Email ?? '');
      if (Number(u.TwoFactorEnabled) === 1) report.twoFactorUsers.push(userName);
      await trx.insertInto('users').values({
        id: String(u.Id),
        user_name: userName,
        normalized_user_name: normalizeKey(userName),
        email,
        normalized_email: normalizeKey(email),
        email_confirmed: Number(u.EmailConfirmed) === 1 ? 1 : 0,
        password_hash: u.PasswordHash === null ? null : String(u.PasswordHash),
        phone_number: u.PhoneNumber === null ? null : String(u.PhoneNumber),
        role: mainRole(String(u.Id)),
        access_failed_count: Number(u.AccessFailedCount ?? 0),
        lockout_end_utc: u.LockoutEnd === null || u.LockoutEnd === undefined ? null : toIso(String(u.LockoutEnd)),
        // Identity didn't store when an account was created.
        created_utc: now.toISOString(),
      }).execute();
    }
    report.counts.users = users.length;

    // ---------- games ----------
    const games = all('select * from Games');
    let placeholderCovers = 0;
    for (const g of games) {
      // The .NET seed's generated SVG placeholders don't count as covers (Game.IsMissingCover) and are never served.
      const coverType = g.CoverContentType === null ? null : String(g.CoverContentType);
      const keepCover = g.Cover !== null && coverType !== null && coverType !== 'image/svg+xml';
      if (g.Cover !== null && !keepCover) placeholderCovers++;
      await trx.insertInto('games').values({
        id: Number(g.Id),
        name: String(g.Name),
        kind: kindOf(g.Kind),
        // EF stored the decimal weight as text; kept as text, "0" meaning not rated.
        weight: Number(g.Difficulty ?? 0) > 0 ? String(g.Difficulty) : '0',
        max_players: Number(g.MaxPlayers),
        bgg_url: g.BggUrl === null ? null : String(g.BggUrl),
        bgg_id: g.BggId === null ? null : Number(g.BggId),
        year_published: g.YearPublished === null ? null : Number(g.YearPublished),
        cover: keepCover ? (g.Cover as Buffer) : null,
        cover_type: keepCover ? coverType : null,
        is_from_sheet: Number(g.IsFromSheet ?? 0) === 1 ? 1 : 0,
      }).execute();
    }
    if (placeholderCovers > 0) report.warnings.push(`${placeholderCovers} generated placeholder cover(s) dropped (SVG).`);
    report.counts.games = games.length;

    const altNames = all('select * from GameAlternateNames');
    for (const a of altNames) {
      await trx.insertInto('game_alternate_names').values({ game_id: Number(a.GameId), name: String(a.Name) }).execute();
    }
    report.counts.alternateNames = altNames.length;

    // ---------- tables and seats ----------
    const tables = all('select * from PlayTables');
    for (const t of tables) {
      await trx.insertInto('play_tables').values({
        id: Number(t.Id),
        game_id: Number(t.GameId),
        game_title: t.GameTitle === null ? null : String(t.GameTitle),
        start_hour: hourOf(String(t.Start)),
        max_players: Number(t.MaxPlayers),
        kind: kindOf(t.Kind),
        owner_user_id: userOrNull(t.OwnerUserId, `Table ${String(t.Id)} owner`),
        taken_slots: Number(t.TakenSlots),
        import_key: t.ImportKey === null || t.ImportKey === undefined ? null : String(t.ImportKey),
        import_order: t.ImportOrder === null || t.ImportOrder === undefined ? null : Number(t.ImportOrder),
      }).execute();
    }
    report.counts.tables = tables.length;

    const slots = all('select * from TableSlots');
    for (const s of slots) {
      await trx.insertInto('table_slots').values({
        play_table_id: Number(s.PlayTableId),
        slot_number: Number(s.SlotNumber),
        participant_name: String(s.ParticipantName),
        user_id: userOrNull(s.UserId, `Seat ${String(s.PlayTableId)}/${String(s.SlotNumber)}`),
        is_imported: Number(s.IsImported ?? 0) === 1 ? 1 : 0,
      }).execute();
    }
    report.counts.seats = slots.length;

    // ---------- phrases, action log, settings ----------
    const phrases = all('select * from TablePhrases');
    for (const p of phrases) {
      await trx.insertInto('table_phrases').values({
        id: Number(p.Id), phrase: String(p.Phrase), game_id: p.GameId === null ? null : Number(p.GameId),
        user_id: p.UserId === null ? null : String(p.UserId), created_utc: toIso(String(p.CreatedUtc)),
      }).execute();
    }
    report.counts.phrases = phrases.length;

    const logs = all('select * from UserActionLogs');
    for (const l of logs) {
      await trx.insertInto('user_action_logs').values({
        id: Number(l.Id),
        created_utc: toIso(String(l.CreatedUtc)),
        action: String(l.Action) as 'JoinedTable' | 'RoleChanged' | 'UserRemoved',
        actor_user_id: nullable(l.ActorUserId), actor_name: nullable(l.ActorName),
        target_user_id: nullable(l.TargetUserId), target_name: nullable(l.TargetName),
        play_table_id: l.PlayTableId === null ? null : Number(l.PlayTableId),
        details: nullable(l.Details),
      }).execute();
    }
    report.counts.logEntries = logs.length;

    const settings = all('select * from BoardSettings where Id = 1')[0];
    if (settings) {
      await trx.updateTable('board_settings').set({
        auto_reset_enabled: Number(settings.AutoResetEnabled) === 1 ? 1 : 0,
        auto_reset_checked_utc: settings.AutoResetCheckedUtc === null ? null : toIso(String(settings.AutoResetCheckedUtc)),
      }).where('id', '=', 1).execute();
    }
  });

  return report;
}

/** EF stored the enum as its name: Small / Big / Other. */
function kindOf(value: unknown): TableKind {
  const kind = String(value ?? 'Small').toLowerCase();
  return kind === 'big' ? 'big' : kind === 'other' ? 'other' : 'small';
}

/** "2026-11-08 18:00:00" → "18:00"; the .NET default "0001-01-01 00:00:00" meant "no hour yet" → null. */
export function hourOf(start: string): string | null {
  if (start.startsWith('0001-01-01')) return null;
  const match = /[ T](\d{2}):(\d{2})/.exec(start);
  return match ? `${match[1]}:${match[2]}` : null;
}

/**
 * EF's SQLite dates are text without a zone ("2026-11-08 12:22:05.1583368"), UTC for *Utc columns; DateTimeOffset
 * values carry "+00:00". Both become ISO 8601 UTC ("2026-11-08T12:22:05.158Z").
 */
export function toIso(value: string): string {
  const hasZone = /([+-]\d{2}:\d{2}|Z)$/.test(value);
  const trimmed = value.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  const date = new Date(hasZone ? trimmed : `${trimmed}Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Unreadable date "${value}".`);
  }
  return date.toISOString();
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

// ---------- command line ----------

if (import.meta.main) {
  const [sourcePath, targetPath] = process.argv.slice(2);
  if (!sourcePath || !targetPath) {
    console.error('Usage: node scripts/import-dotnet-db.ts <app.db copy> <new database file>');
    process.exit(1);
  }
  if (!existsSync(sourcePath)) {
    console.error(`Source not found: ${sourcePath}`);
    process.exit(1);
  }
  if (existsSync(targetPath)) {
    console.error(`Target already exists, refusing to overwrite: ${targetPath}`);
    process.exit(1);
  }
  const source = new SqliteDatabase(sourcePath, { readonly: true, fileMustExist: true });
  const target = openDatabase(targetPath);
  try {
    await migrateToLatest(target);
    const report = await convertDotnetDb(source, target);
    console.log('Copied:', report.counts);
    for (const w of report.warnings) console.log('Note:', w);
    if (report.twoFactorUsers.length > 0) {
      console.log(`WARNING: these accounts had two-factor authentication, which v1 doesn't have: ${report.twoFactorUsers.join(', ')}`);
    }
  } finally {
    source.close();
    await target.destroy();
  }
}
