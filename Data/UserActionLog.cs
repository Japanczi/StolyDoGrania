using Planszowkarz.Data.Table;

namespace Planszowkarz.Data;

/// <summary>Kinds of logged user actions. Stored as text, so new kinds can be added freely.</summary>
public enum UserAction
{
    /// <summary>A user took a seat at a table themselves.</summary>
    JoinedTable,

    /// <summary>An admin changed someone's role.</summary>
    RoleChanged,

    /// <summary>An admin deleted someone's account.</summary>
    UserRemoved
}

/// <summary>
/// One logged user action. Names are copied in, so the entry stays readable after the user or table is gone.
/// Server-side record only; user names, not e-mails, are stored.
/// </summary>
public class UserActionLog
{
    public const int NameMaxLength = 256;
    public const int DetailsMaxLength = 500;

    public long Id { get; set; }

    public DateTime CreatedUtc { get; set; }

    public UserAction Action { get; set; }

    /// <summary>Who did it.</summary>
    public string? ActorUserId { get; set; }
    public string? ActorName { get; set; }

    /// <summary>The user acted on (role change, removal); null for actions on oneself.</summary>
    public string? TargetUserId { get; set; }
    public string? TargetName { get; set; }

    /// <summary>The table involved, if any. Not a foreign key: tables are deleted every week.</summary>
    public int? PlayTableId { get; set; }

    /// <summary>Human-readable details, e.g. the game and slot, or the old and new role.</summary>
    public string? Details { get; set; }

    public static UserActionLog JoinedTable(PlayTable table, int slot, string userId, string userName) => new()
    {
        CreatedUtc = DateTime.UtcNow,
        Action = UserAction.JoinedTable,
        ActorUserId = userId,
        ActorName = userName,
        PlayTableId = table.Id,
        Details = Truncate($"{table.DisplayTitle} – miejsce {slot}")
    };

    public static UserActionLog RoleChanged(string actorId, string? actorName, ApplicationUser target, string oldRole, string newRole) => new()
    {
        CreatedUtc = DateTime.UtcNow,
        Action = UserAction.RoleChanged,
        ActorUserId = actorId,
        ActorName = actorName,
        TargetUserId = target.Id,
        TargetName = target.UserName,
        Details = $"{oldRole} → {newRole}"
    };

    public static UserActionLog UserRemoved(string actorId, string? actorName, ApplicationUser target, string role) => new()
    {
        CreatedUtc = DateTime.UtcNow,
        Action = UserAction.UserRemoved,
        ActorUserId = actorId,
        ActorName = actorName,
        TargetUserId = target.Id,
        TargetName = target.UserName,
        Details = $"Rola: {role}"
    };

    private static string Truncate(string s) => s.Length <= DetailsMaxLength ? s : s[..DetailsMaxLength];
}
