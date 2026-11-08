namespace Planszowkarz.Data;

/// <summary>App-wide table rules, read from the "Tables" section of appsettings.json.</summary>
public sealed class TableSettings
{
    public const string SectionName = "Tables";

    /// <summary>Games with a higher player count can't get a table.</summary>
    public int MaximumSpotsAllowed { get; set; } = 20;
}
