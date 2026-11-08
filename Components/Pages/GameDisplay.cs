using System.Globalization;

namespace Planszowkarz.Components.Pages;

/// <summary>Display helpers shared by the pages that show games (tables board, games catalog).</summary>
public static class GameDisplay
{
    public static string? CoverSrc(Game game) => CoverSrc(game.Cover, game.CoverContentType);

    public static string? CoverSrc(byte[]? cover, string? contentType) =>
        cover is { Length: > 0 }
            ? $"data:{contentType ?? "image/jpeg"};base64,{Convert.ToBase64String(cover)}"
            : null;

    // Derived from the name, so a game keeps its colour across restarts (string.GetHashCode would not).
    public static int PlaceholderHue(string name) => name.Sum(c => (int)c) * 47 % 360;

    // 0 means "not rated": BGG weights start at 1.
    public static string DifficultyLabel(decimal difficulty) =>
        difficulty > 0 ? difficulty.ToString("0.####", CultureInfo.InvariantCulture) : "–";

    // Heat scale over the 0–5 range: green (easy) through yellow and orange to red (hard).
    public static string? DifficultyStyle(decimal difficulty) =>
        difficulty > 0 ? $"background-color:hsl({(int)(120 - difficulty * 24)}, 85%, 68%);color:#222;" : null;

    public static string KindLabel(TableKind kind) => kind switch
    {
        TableKind.Small => "Mały",
        TableKind.Big => "Duży",
        _ => "Inny"
    };

    public static string KindClass(TableKind kind) => kind switch
    {
        TableKind.Small => "kind-small",
        TableKind.Big => "kind-big",
        _ => "kind-other"
    };
}
