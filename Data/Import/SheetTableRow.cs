namespace Planszowkarz.Data.Import;

/// <summary>One game row of the sign-up sheet ("Zapisy"), already cleaned up by <see cref="SheetParser"/>.</summary>
/// <param name="Title">Trimmed, at most 200 characters.</param>
/// <param name="Start">Null when the sheet has no hour yet.</param>
/// <param name="Weight">BGG weight as copied by the sheet; 0 when empty.</param>
/// <param name="TakenSlots">How many seats within <paramref name="MaxPlayers"/> say "Zajęte".</param>
/// <param name="Players">Seat number (1-based) → player name, for seats with a name.</param>
public sealed record SheetTableRow(
    string Title,
    TableKind Kind,
    TimeOnly? Start,
    int MaxPlayers,
    decimal Weight,
    int TakenSlots,
    IReadOnlyDictionary<int, string> Players)
{
    public const int MaxTitleLength = 200;
    public const int MaxKeyLength = 220;

    /// <summary>
    /// Keys that tie sheet rows to tables between imports: the title (case and spacing ignored) plus its occurrence
    /// number, so two tables of the same game stay apart. Renaming a row in the sheet replaces its table.
    /// </summary>
    public static IReadOnlyList<string> KeysFor(IEnumerable<SheetTableRow> rows)
    {
        var seen = new Dictionary<string, int>();
        var keys = new List<string>();
        foreach (var row in rows)
        {
            var title = NormalizeTitle(row.Title);
            var occurrence = seen.GetValueOrDefault(title) + 1;
            seen[title] = occurrence;
            keys.Add($"{title}#{occurrence}");
        }

        return keys;
    }

    public static string NormalizeTitle(string title) =>
        string.Join(' ', title.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries)).ToLowerInvariant();
}
