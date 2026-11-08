namespace Planszowkarz.Data.Table;

/// <summary>Settings for the whole list of tables, stored as a single row with <see cref="SingletonId"/>.</summary>
public class BoardSettings
{
    public const int SingletonId = 1;

    public int Id { get; set; } = SingletonId;

    /// <summary>When on, the list of tables is cleared every Monday at midnight, server time.</summary>
    public bool AutoResetEnabled { get; private set; }

    /// <summary>
    /// When the last automatic reset ran, or when it was switched on, so that a Monday which has already
    /// passed doesn't trigger one. Null until it is first switched on.
    /// </summary>
    public DateTime? AutoResetCheckedUtc { get; private set; }

    public void SetAutoReset(bool enabled, DateTime nowUtc)
    {
        if (enabled && !AutoResetEnabled)
        {
            AutoResetCheckedUtc = nowUtc;
        }

        AutoResetEnabled = enabled;
    }

    /// <summary>
    /// True when a Monday midnight has passed since the last check. This also catches up on one missed
    /// while the app was down, resetting once rather than once per missed week.
    /// </summary>
    public bool IsAutoResetDue(DateTime nowUtc, TimeZoneInfo timeZone) =>
        AutoResetEnabled && AutoResetCheckedUtc is { } checkedUtc && checkedUtc < LastMondayMidnightUtc(nowUtc, timeZone);

    public void MarkAutoReset(DateTime nowUtc) => AutoResetCheckedUtc = nowUtc;

    /// <summary>The most recent Monday 00:00 in <paramref name="timeZone"/>, at or before <paramref name="nowUtc"/>, as UTC.</summary>
    public static DateTime LastMondayMidnightUtc(DateTime nowUtc, TimeZoneInfo timeZone)
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(nowUtc, DateTimeKind.Utc), timeZone);
        var daysSinceMonday = ((int)local.DayOfWeek + 6) % 7;
        var monday = DateTime.SpecifyKind(local.Date.AddDays(-daysSinceMonday), DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(monday, timeZone);
    }
}
