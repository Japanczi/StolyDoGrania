using StolyDoGrania.Data.Table;

namespace StolyDoGrania;

/// <summary>Gra jako "produkt" w katalogu – użytkownicy dodają ją do swoich stołów.</summary>
public class Game
{
    public int Id { get; set; }

    /// <summary>Nazwa gry (unikalna w katalogu).</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Rodzaj stołu potrzebnego do gry.</summary>
    public TableKind Kind { get; set; } = TableKind.Small;

    /// <summary>Poziom trudności (np. "weight" z BGG, skala 1–5).</summary>
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
}
