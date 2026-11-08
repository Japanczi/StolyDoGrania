namespace Planszowkarz.Data.Table;

/// <summary>Another title of a game (translations, older editions), as listed by BGG. Lets users find it by any of them.</summary>
public class GameAlternateName
{
    public int GameId { get; set; }

    public string Name { get; set; } = string.Empty;
}
