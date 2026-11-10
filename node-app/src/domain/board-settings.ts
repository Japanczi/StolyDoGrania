// The weekly automatic reset rule. Port of Data/Table/BoardSettings.cs.
//
// Uses the built-in Temporal API (in Node 26 without a flag): it knows time zones and calendar days, so
// "the most recent Monday 00:00 in Warsaw" is a few readable lines instead of offset arithmetic with Date.
// The .NET app used the server's local zone; here it's Europe/Warsaw explicitly (brief 7.5), whatever the server is set to.

export const boardTimeZone = 'Europe/Warsaw';

export type AutoResetSettings = {
  enabled: boolean;
  /** When the last automatic reset ran, or when the switch was turned on; null until first switched on. */
  checkedUtc: Date | null;
};

/** The most recent Monday 00:00 in `timeZone`, at or before `now`. */
export function lastMondayMidnight(now: Date, timeZone: string = boardTimeZone): Date {
  const local = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timeZone);
  // dayOfWeek: 1 = Monday … 7 = Sunday.
  const monday = local.toPlainDate().subtract({ days: local.dayOfWeek - 1 });
  return new Date(monday.toZonedDateTime({ timeZone }).epochMilliseconds);
}

/**
 * True when a Monday midnight has passed since the last check. This also catches up on one missed while the app
 * was down, resetting once rather than once per missed week. Turning it on midweek waits for the next Monday.
 */
export function isAutoResetDue(settings: AutoResetSettings, now: Date, timeZone: string = boardTimeZone): boolean {
  return settings.enabled && settings.checkedUtc !== null && settings.checkedUtc < lastMondayMidnight(now, timeZone);
}

/** Switching on records "now", so a Monday that has already passed doesn't trigger a reset. */
export function setAutoReset(settings: AutoResetSettings, enabled: boolean, now: Date): AutoResetSettings {
  return { enabled, checkedUtc: enabled && !settings.enabled ? now : settings.checkedUtc };
}
