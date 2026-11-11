// Admins who chose to use the app as a regular user, for testing the UI. Port of Data/NormalUserMode.cs.
// Kept in memory, so everyone is back to their real role after a restart. Applied where the session is loaded
// (request-auth.ts): the admin's role reads as 'user' everywhere, like .NET's claims transformation. It can only
// remove a role, so being listed here can never grant anything.

export class NormalUserMode {
  readonly #active = new Set<string>();

  isActive(userId: string): boolean {
    return this.#active.has(userId);
  }

  set(userId: string, active: boolean): void {
    if (active) {
      this.#active.add(userId);
    } else {
      this.#active.delete(userId);
    }
  }
}
