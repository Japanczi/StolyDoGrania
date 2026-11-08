namespace Planszowkarz.Data.Import;

/// <summary>Import of the Google sign-up sheet, read from the "SheetImport" configuration section.</summary>
public sealed class SheetImportSettings
{
    public const string SectionName = "SheetImport";

    public bool Enabled { get; set; }

    /// <summary>
    /// The sheet's public Google Visualization feed in JSON, e.g.
    /// https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:json&amp;headers=1&amp;sheet=Zapisy.
    /// The feed picks the tab by name (it ignores gid), so renaming the tab needs this updated.
    /// </summary>
    public string SourceUrl { get; set; } = "";

    public int IntervalMinutes { get; set; } = 30;
}
