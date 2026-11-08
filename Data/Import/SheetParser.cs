using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Planszowkarz.Data.Import;

/// <summary>The sheet couldn't be read, or doesn't look like the sign-up sheet. Nothing is synced then.</summary>
public sealed class SheetFormatException(string message, Exception? innerException = null) : Exception(message, innerException);

/// <summary>
/// Reads the "Zapisy" tab from Google's Visualization feed (JSON). Columns are found by their header label,
/// so moving them in the sheet doesn't matter; BGG links and covers are not imported.
/// </summary>
public static partial class SheetParser
{
    public const int MaxNameLength = 100;

    private const string FreeSeat = "WOLNE";
    private const string TakenSeat = "ZAJĘTE";

    /// <summary>Parses the feed's response body: <c>/*O_o*/ google.visualization.Query.setResponse({...});</c>.</summary>
    /// <exception cref="SheetFormatException">The response isn't a readable sign-up sheet.</exception>
    public static IReadOnlyList<SheetTableRow> Parse(string response)
    {
        var start = response.IndexOf('{');
        var end = response.LastIndexOf('}');
        if (start < 0 || end < start)
        {
            throw new SheetFormatException("The response holds no JSON.");
        }

        try
        {
            using var document = JsonDocument.Parse(response.AsMemory(start, end - start + 1));
            return Parse(document.RootElement);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or KeyNotFoundException or FormatException)
        {
            throw new SheetFormatException("The response isn't valid sheet JSON.", e);
        }
    }

    private static List<SheetTableRow> Parse(JsonElement root)
    {
        if (root.GetProperty("status").GetString() != "ok")
        {
            throw new SheetFormatException("The sheet feed reported an error (wrong tab name or a private sheet?).");
        }

        var table = root.GetProperty("table");
        var labels = table.GetProperty("cols").EnumerateArray()
            .Select(c => c.TryGetProperty("label", out var l) ? (l.GetString() ?? "").Trim() : "")
            .ToList();

        var title = FindColumn(labels, "Tytul", "Tytuł") ?? throw new SheetFormatException("No \"Tytul\" column.");
        var max = FindColumn(labels, "Max") ?? throw new SheetFormatException("No \"Max\" column.");
        var kind = FindColumn(labels, "Stół", "Stol");
        var hour = FindColumn(labels, "Start");
        var weight = FindColumn(labels, "Waga");

        // Slot columns by number: "Slot 1" → seat 1.
        var slots = labels
            .Select((label, index) => (Match: SlotLabel().Match(label), Index: index))
            .Where(x => x.Match.Success)
            .ToDictionary(x => int.Parse(x.Match.Groups[1].Value, CultureInfo.InvariantCulture), x => x.Index);
        if (!slots.ContainsKey(1))
        {
            throw new SheetFormatException("No \"Slot 1\" column.");
        }

        var rows = new List<SheetTableRow>();
        foreach (var row in table.GetProperty("rows").EnumerateArray())
        {
            var cells = row.GetProperty("c").EnumerateArray().ToList();
            var rowTitle = Truncate(Text(cells, title), SheetTableRow.MaxTitleLength);
            if (rowTitle.Length == 0)
            {
                continue;
            }

            var maxPlayers = (int)Math.Round(Number(cells, max) ?? 0);
            if (maxPlayers < 1)
            {
                // No seat count yet: count up to the last filled seat, so nobody disappears.
                maxPlayers = slots.Where(s => Text(cells, s.Value).Length > 0).Select(s => s.Key).DefaultIfEmpty(0).Max();
            }

            if (maxPlayers < 1)
            {
                continue;
            }

            var players = new Dictionary<int, string>();
            var taken = 0;
            foreach (var (seat, column) in slots.Where(s => s.Key <= maxPlayers))
            {
                var value = Text(cells, column);
                if (value.Length == 0 || value.Equals(FreeSeat, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (value.Equals(TakenSeat, StringComparison.OrdinalIgnoreCase))
                {
                    taken++;
                }
                else
                {
                    players[seat] = Truncate(value, MaxNameLength);
                }
            }

            rows.Add(new SheetTableRow(
                rowTitle,
                ParseKind(kind is { } k ? Text(cells, k) : ""),
                hour is { } h ? ParseHour(Cell(cells, h)) : null,
                maxPlayers,
                ParseWeight(weight is { } w ? Number(cells, w) : null),
                taken,
                players));
        }

        return rows;
    }

    internal static TableKind ParseKind(string value) => value.Trim().ToUpperInvariant() switch
    {
        "" or "MAŁY" or "MALY" => TableKind.Small,
        "DUŻY" or "DUZY" => TableKind.Big,
        _ => TableKind.Other
    };

    /// <summary>Hours come as <c>Date(1899,11,30,18,0,0)</c>, with "18:00" as the formatted value.</summary>
    private static TimeOnly? ParseHour(JsonElement? cell)
    {
        if (cell is not { } c)
        {
            return null;
        }

        if (c.TryGetProperty("v", out var v) && v.ValueKind == JsonValueKind.String
            && DateValue().Match(v.GetString() ?? "") is { Success: true } m && m.Groups[4].Success)
        {
            var hours = int.Parse(m.Groups[4].Value, CultureInfo.InvariantCulture);
            var minutes = int.Parse(m.Groups[5].Value, CultureInfo.InvariantCulture);
            return hours is >= 0 and < 24 && minutes is >= 0 and < 60 ? new TimeOnly(hours, minutes) : null;
        }

        var text = c.TryGetProperty("f", out var f) ? f.GetString() : v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        return TimeOnly.TryParse(text, CultureInfo.GetCultureInfo("pl-PL"), out var time) ? time : null;
    }

    /// <summary>Stored with four decimals at most, like BGG's own weights; out-of-range values count as no rating.</summary>
    private static decimal ParseWeight(double? value) =>
        value is >= 0 and < 10 ? Math.Round((decimal)value.Value, 4) : 0;

    private static int? FindColumn(List<string> labels, params string[] names)
    {
        var index = labels.FindIndex(l => names.Contains(l, StringComparer.OrdinalIgnoreCase));
        return index < 0 ? null : index;
    }

    private static JsonElement? Cell(List<JsonElement> cells, int index) =>
        index < cells.Count && cells[index].ValueKind == JsonValueKind.Object ? cells[index] : null;

    private static string Text(List<JsonElement> cells, int index)
    {
        if (Cell(cells, index) is not { } cell || !cell.TryGetProperty("v", out var v))
        {
            return "";
        }

        var text = v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => cell.TryGetProperty("f", out var f) ? f.GetString() : v.GetRawText(),
            _ => null
        };
        return string.Join(' ', (text ?? "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
    }

    private static double? Number(List<JsonElement> cells, int index) =>
        Cell(cells, index) is { } cell && cell.TryGetProperty("v", out var v) && v.ValueKind == JsonValueKind.Number
            ? v.GetDouble()
            : null;

    private static string Truncate(string value, int length) => value.Length <= length ? value : value[..length].TrimEnd();

    [GeneratedRegex(@"^Slot\s*(\d+)$", RegexOptions.IgnoreCase)]
    private static partial Regex SlotLabel();

    [GeneratedRegex(@"^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+)(?:,(\d+))?)?\)$")]
    private static partial Regex DateValue();
}
