// "Użytkownicy" (/admin/users): roles, adding and deleting accounts. Port of Components/Pages/Admin/Users.razor.
//
// Rules (CLAUDE.md): Owner ⊃ Admin ⊃ User. Admins may make users admins and delete regular users; only the Owner may
// take the Admin role away or delete an admin; nobody changes or deletes the Owner; nobody deletes themselves here.
// Everything is re-checked against the database on each POST (domain/roles.ts canManage); the disabled controls
// in the page are only a hint. Plain HTML forms with Post/Redirect/Get – this page needs no JavaScript except the
// role <select> submitting itself (public/js/admin-users.js).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../../../config.ts';
import type { Db } from '../../../db/database.ts';
import { createUser, deleteUser, findUserById, isUniqueViolation, setRole, setUserName, type User } from '../../../db/queries/users.ts';
import type { Role } from '../../../db/schema.ts';
import { passwordStrengthErrors } from '../../../domain/password-policy.ts';
import { canManage, isAdminRole } from '../../../domain/roles.ts';
import { normalizeUserName, shortName } from '../../../domain/user-name.ts';
import { hashPassword } from '../../../auth/password-hash.ts';
import { field, hasErrors, readForm, setFlash, takeFlash, type FieldErrors } from '../../forms.ts';
import { html } from '../../html.ts';
import { requireUser, sendPage } from '../../respond.ts';
import { checkEmail, checkNewPasswordSimple, checkUserName } from './users-validation.ts';
import { usersPage, type UserRow } from './users-view.ts';

export const protectedAdminHint = 'Tylko główny administrator (Owner) może odebrać rolę administratora lub usunąć jego konto.';
export const protectedRenameHint = 'Tylko główny administrator (Owner) może zmienić nazwę konta administratora.';
const assignable: readonly Role[] = ['admin', 'user'];

export function usersRoutes(app: FastifyInstance, deps: { config: Config; db: Db }): void {
  const { db, config } = deps;

  /** The logged-in admin, re-read from the database; null if not logged in or not an admin (normal user mode included). */
  async function adminFromDb(request: FastifyRequest): Promise<User | null> {
    if (!request.user || !isAdminRole(request.user.role)) return null;
    const row = await findUserById(db, request.user.id);
    return row && isAdminRole(row.role) ? row : null;
  }

  /** The acting admin for page requests (null after redirecting to the login or "access denied" page). */
  async function actor(request: FastifyRequest, reply: FastifyReply): Promise<User | null> {
    if (!requireUser(request, reply)) return null;
    const row = await adminFromDb(request);
    if (!row) void reply.redirect('/Account/AccessDenied', 303);
    return row;
  }

  async function show(
    request: FastifyRequest, reply: FastifyReply, me: User,
    extra: { errors?: FieldErrors; values?: Record<string, string>; error?: string | null; renameId?: string } = {},
  ) {
    const users = await db.selectFrom('users').select(['id', 'user_name', 'email', 'role']).orderBy('email').execute();
    // E-mail addresses are hidden behind "Pokaż e-mail" (decided 2026-11-11); only the one asked for with
    // ?email=<id> (the no-JavaScript fallback of that button) is put into the page.
    const shownEmailId = String((request.query as Record<string, unknown>).email ?? '');
    const rows: UserRow[] = users.map(u => ({
      id: u.id, userName: u.user_name, email: u.id === shownEmailId ? u.email : null, role: u.role,
      isSelf: u.id === me.id,
      // Mirrors the checks in the POST handlers, which are what actually enforce them.
      manageable: u.id !== me.id && canManage(u.role, me.role === 'owner'),
    }));
    const flash = takeFlash(request, reply);
    return sendPage(request, reply, {
      enhance: true,
      title: 'Użytkownicy',
      scripts: html`<script src="/js/admin-users.js"></script>`,
      body: usersPage(request, {
        rows,
        confirmDeleteId: String((request.query as Record<string, unknown>).usun ?? ''),
        renameId: extra.renameId ?? String((request.query as Record<string, unknown>).zmien ?? ''),
        status: flash && !flash.startsWith('Błąd') ? flash : null,
        error: extra.error ?? (flash?.startsWith('Błąd') ? flash.slice('Błąd: '.length) : null),
        errors: extra.errors ?? {},
        values: extra.values ?? {},
      }),
    });
  }

  app.get('/admin/users', async (request, reply) => {
    const me = await actor(request, reply);
    if (!me) return reply;
    return show(request, reply, me);
  });

  /**
   * One user's e-mail address as JSON, for the "Pokaż e-mail" button (public/js/admin-users.js). JSON rather than
   * HTML because Cloudflare's e-mail obfuscation rewrites addresses only in HTML; it also keeps the addresses out of
   * the page until an admin asks for one. Admin-only, re-checked against the database like every action here.
   */
  app.get('/admin/users/:id/email', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!(await adminFromDb(request))) return reply.code(403).send({ ok: false, error: 'Brak dostępu.' });
    const target = await findUserById(db, (request.params as Record<string, string>).id ?? '');
    if (!target) return reply.code(404).send({ ok: false, error: 'Nie znaleziono użytkownika.' });
    return reply.send({ ok: true, email: target.email });
  });

  app.post('/admin/users/add', async (request, reply) => {
    const me = await actor(request, reply);
    if (!me) return reply;
    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const userName = checkUserName(form, errors);
    const email = checkEmail(form, errors);
    const password = checkNewPasswordSimple(form, errors);
    const role = assignable.find(r => r === field(form, 'Role'));
    const values = { UserName: field(form, 'UserName'), Email: field(form, 'Email'), Role: field(form, 'Role') };
    if (!role) return show(request, reply, me, { error: 'Nieprawidłowa rola.', values });
    if (hasErrors(errors)) return show(request, reply, me, { errors, values });
    const weak = passwordStrengthErrors(password, config.environment === 'production');
    if (weak.length > 0) return show(request, reply, me, { error: weak.join(' '), values });

    const created = await createUser(db, {
      userName: normalizeUserName(userName), email, passwordHash: await hashPassword(password), emailConfirmed: true, role,
    });
    if (!created.ok) {
      return show(request, reply, me, {
        error: created.taken === 'email' ? 'Ten adres e-mail jest już zarejestrowany.' : 'Ta nazwa użytkownika jest już zajęta.', values,
      });
    }
    setFlash(reply, `Dodano użytkownika ${created.user.user_name}.`);
    return reply.redirect('/admin/users', 303);
  });

  app.post('/admin/users/:id/role', async (request, reply) => {
    const me = await actor(request, reply);
    if (!me) return reply;
    const id = (request.params as Record<string, string>).id ?? '';
    const newRole = assignable.find(r => r === field(readForm(request.body), 'Role'));
    const done = (message: string) => { setFlash(reply, message); return reply.redirect('/admin/users', 303); };
    if (!newRole || id === me.id) return reply.redirect('/admin/users', 303);

    const target = await findUserById(db, id);
    if (!target) return done('Błąd: Nie znaleziono użytkownika.');
    if (!canManage(target.role, me.role === 'owner')) {
      return done(`Błąd: ${target.role === 'owner' ? 'Nie można zmienić roli głównego administratora.' : protectedAdminHint}`);
    }
    if (target.role === newRole) return reply.redirect('/admin/users', 303);

    // The new role applies at the user's next request: roles are read from the database every time.
    await db.transaction().execute(async trx => {
      await setRole(trx, target.id, newRole);
      await trx.insertInto('user_action_logs').values({
        created_utc: new Date().toISOString(), action: 'RoleChanged', actor_user_id: me.id, actor_name: me.user_name,
        target_user_id: target.id, target_name: target.user_name, play_table_id: null,
        details: `${roleName(target.role)} → ${roleName(newRole)}`,
      }).execute();
    });
    return done(`Zmieniono rolę użytkownika ${target.user_name} na ${roleName(newRole)}.`);
  });

  /**
   * Renames a user (new in the Node app, requested 2026-11-11). Same rules as roles and deletion: admins rename
   * regular users, only the Owner renames admins, nobody renames the Owner or themselves here. The name follows
   * the registration rules and must be unique; their seats show the new name; the change is logged.
   */
  app.post('/admin/users/:id/name', async (request, reply) => {
    const me = await actor(request, reply);
    if (!me) return reply;
    const id = (request.params as Record<string, string>).id ?? '';
    const done = (message: string) => { setFlash(reply, message); return reply.redirect('/admin/users', 303); };
    if (id === me.id) return done('Błąd: Nie możesz zmienić tutaj własnej nazwy użytkownika.');
    const target = await findUserById(db, id);
    if (!target) return done('Błąd: Nie znaleziono użytkownika.');
    if (!canManage(target.role, me.role === 'owner')) {
      return done(`Błąd: ${target.role === 'owner' ? 'Nie można zmienić nazwy głównego administratora.' : protectedRenameHint}`);
    }

    const form = readForm(request.body);
    const errors: FieldErrors = {};
    const raw = checkUserName(form, errors);
    // A form error keeps the rename form open with what was typed.
    if (hasErrors(errors)) return show(request, reply, me, { errors, renameId: id, values: { UserName: raw } });
    const newName = normalizeUserName(raw);
    if (newName === target.user_name) return reply.redirect('/admin/users', 303);

    let renamed = false;
    try {
      renamed = await db.transaction().execute(async trx => {
        if (!(await setUserName(trx, target.id, newName, shortName(newName)))) return false;
        await trx.insertInto('user_action_logs').values({
          created_utc: new Date().toISOString(), action: 'UserRenamed', actor_user_id: me.id, actor_name: me.user_name,
          target_user_id: target.id, target_name: newName, play_table_id: null, details: `${target.user_name} → ${newName}`,
        }).execute();
        return true;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    if (!renamed) {
      return show(request, reply, me, { error: 'Ta nazwa użytkownika jest już zajęta.', renameId: id, values: { UserName: raw } });
    }
    return done(`Zmieniono nazwę użytkownika ${target.user_name} na ${newName}.`);
  });

  app.post('/admin/users/:id/delete', async (request, reply) => {
    const me = await actor(request, reply);
    if (!me) return reply;
    const id = (request.params as Record<string, string>).id ?? '';
    const done = (message: string) => { setFlash(reply, message); return reply.redirect('/admin/users', 303); };
    if (id === me.id) return done('Błąd: Nie możesz usunąć własnego konta.');
    const target = await findUserById(db, id);
    if (!target) return done('Błąd: Nie znaleziono użytkownika.');
    if (!canManage(target.role, me.role === 'owner')) {
      return done(`Błąd: ${target.role === 'owner' ? 'Nie można usunąć konta głównego administratora.' : protectedAdminHint}`);
    }
    // The user's seats and tables stay on the board (decided 2026-11-10; the .NET page freed the seats).
    await db.transaction().execute(async trx => {
      await deleteUser(trx, target.id);
      await trx.insertInto('user_action_logs').values({
        created_utc: new Date().toISOString(), action: 'UserRemoved', actor_user_id: me.id, actor_name: me.user_name,
        target_user_id: target.id, target_name: target.user_name, play_table_id: null, details: `Rola: ${roleName(target.role)}`,
      }).execute();
    });
    return done(`Usunięto użytkownika ${target.user_name}.`);
  });
}

/** Role names as the .NET app showed and logged them. */
export function roleName(role: Role): string {
  return role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'User';
}
