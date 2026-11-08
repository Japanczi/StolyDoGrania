namespace Planszowkarz.Data.Table;

/// <summary>
/// The game name used when a table was created with "Utwórz stół" (board or Baza gier), kept for good:
/// it outlives the table and the weekly reset. Renaming a table doesn't add one.
/// </summary>
public class TablePhrase
{
    public const int MaxLength = 200;

    public int Id { get; set; }

    /// <summary>The name as entered (trimmed); on Baza gier, the catalog name.</summary>
    public string Phrase { get; set; } = string.Empty;

    /// <summary>The catalog game it led to; null once that game is deleted.</summary>
    public int? GameId { get; set; }
    public Game? Game { get; set; }

    /// <summary>Who created the table. Stored only, never displayed.</summary>
    public string? UserId { get; set; }

    public DateTime CreatedUtc { get; set; }

    /// <summary>The phrase to record for a table that has just been created.</summary>
    public static TablePhrase For(PlayTable table, string? userId) => new()
    {
        Phrase = table.DisplayTitle.Trim(),
        Game = table.Game,
        UserId = userId,
        CreatedUtc = DateTime.UtcNow
    };
}
