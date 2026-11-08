using Planszowkarz.Data.Bgg;
using Planszowkarz.Data.Table;

namespace Planszowkarz;

/// <summary>Gra jako "produkt" w katalogu – użytkownicy dodają ją do swoich stołów.</summary>
public class Game
{
    public const long MaxCoverBytes = 2 * 1024 * 1024;
    public static readonly string[] AllowedCoverTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];

    public int Id { get; set; }

    /// <summary>Nazwa gry (unikalna w katalogu).</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Rodzaj stołu potrzebnego do gry.</summary>
    public TableKind Kind { get; set; } = TableKind.Small;

    /// <summary>BGG's average weight, set only from BGG data (directly, or as copied by the sign-up sheet); 0 means no rating.</summary>
    public decimal Difficulty { get; set; }

    /// <summary>Maksymalna liczba graczy przewidziana przez grę (domyślna pojemność stołu).</summary>
    public int MaxPlayers { get; set; }

    /// <summary>Link do gry na BoardGameGeek.</summary>
    public Uri? BggUrl { get; set; }

    /// <summary>Okładka gry jako osadzony obraz (surowe bajty).</summary>
    public byte[]? Cover { get; set; }

    /// <summary>Typ MIME okładki, np. "image/jpeg" lub "image/svg+xml".</summary>
    public string? CoverContentType { get; set; }

    /// <summary>Stoły, przy których gra się w tę grę.</summary>
    public List<PlayTable> Tables { get; set; } = new();

    /// <summary>Id of the game on BGG; null for games added by hand.</summary>
    public int? BggId { get; set; }

    /// <summary>Year published, as given by BGG; tells editions with the same name apart.</summary>
    public int? YearPublished { get; set; }

    /// <summary>Other titles of this game, as listed by BGG.</summary>
    public List<GameAlternateName> AlternateNames { get; set; } = new();

    /// <summary>
    /// True for a game the sign-up sheet import added to the catalog. The import deletes it again once no table uses it;
    /// attaching BGG data in the app clears the flag, so the game then stays.
    /// </summary>
    public bool IsFromSheet { get; set; }

    /// <summary>A generated placeholder doesn't count as a cover.</summary>
    public bool IsMissingCover => Cover is null || CoverContentType == "image/svg+xml";

    /// <summary>Users can only provide a cover for a game that BGG doesn't have, and only once.</summary>
    public bool CanUploadCover => BggId is null && IsMissingCover;

    /// <summary>
    /// Copies BGG's data onto this game, unmodified, as BGG's terms require. BGG's data takes priority over
    /// a hand-added game's, including its cover; a cover that already came from BGG is kept.
    /// </summary>
    public void ApplyBggData(BggGameDetails details, BggCover? cover)
    {
        var wasHandAdded = BggId is null;
        IsFromSheet = false;

        BggId = details.Id;
        BggUrl = new Uri($"https://boardgamegeek.com/boardgame/{details.Id}");
        YearPublished = details.Year;
        Difficulty = details.Weight;
        MaxPlayers = details.MaxPlayers;

        if (cover is not null && (wasHandAdded || IsMissingCover))
        {
            Cover = cover.Bytes;
            CoverContentType = cover.ContentType;
        }

        // Synced rather than replaced: EF can't track a removed and an added row with the same key.
        AlternateNames.RemoveAll(a => !details.AlternateNames.Contains(a.Name, StringComparer.OrdinalIgnoreCase));
        foreach (var name in details.AlternateNames)
        {
            if (!AlternateNames.Any(a => string.Equals(a.Name, name, StringComparison.OrdinalIgnoreCase)))
            {
                AlternateNames.Add(new GameAlternateName { Name = name });
            }
        }
    }
}
