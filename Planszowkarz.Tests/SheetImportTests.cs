using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Planszowkarz.Data;
using Planszowkarz.Data.Import;
using Planszowkarz.Data.Table;

namespace Planszowkarz.Tests;

/// <summary>Reading the Google feed of the "Zapisy" tab.</summary>
public class SheetParserTests
{
    // Shaped like the real feed (2026-11-08), cut down to the columns and rows the tests need.
    private const string Feed = """
        /*O_o*/
        google.visualization.Query.setResponse({"version":"0.6","reqId":"0","status":"ok","table":{"cols":[
        {"id":"A","label":"Tytul","type":"string"},{"id":"B","label":"Zajęte","type":"number"},{"id":"C","label":"Stół","type":"string"},
        {"id":"D","label":"Start","type":"datetime"},{"id":"E","label":"Max","type":"number"},{"id":"F","label":"BGG","type":"string"},
        {"id":"G","label":"Waga","type":"number"},{"id":"H","label":"Okładka","type":"string"},
        {"id":"I","label":"Slot 1","type":"string"},{"id":"J","label":"Slot 2","type":"string"},{"id":"K","label":"Slot 3","type":"string"},
        {"id":"L","label":"Slot 4","type":"string"},{"id":"M","label":"Slot 5","type":"string"},{"id":"N","label":"","type":"string"}],
        "rows":[
        {"c":[{"v":"Splendor marvel"},{"v":3.0,"f":"3"},{"v":"Mały"},{"v":"Date(1899,11,30,18,0,0)","f":"18:00"},{"v":4.0,"f":"4"},{"v":"Link"},{"v":1.7966,"f":"1,80"},null,{"v":"Zajęte"},{"v":"Zajęte"},{"v":"Zajęte"},{"v":"WOLNE"},null,{"v":"uwagi"}]},
        {"c":[{"v":"Grimcoven "},null,{"v":"Duży"},null,{"v":5.0,"f":"5"},{"v":"Link"},{"v":3.7432,"f":"3,74"},null,{"v":"Patryk Czaja"},{"v":"Krzysztof P."},{"v":"Paweł D."},{"v":"WOLNE"},{"v":"WOLNE"},null]},
        {"c":[null,null,null,null,null,null,null,null,null,null,null,null,null,null]},
        {"c":[{"v":"Bez max"},null,{"v":"Inny"},null,null,null,null,null,{"v":"Ala"},null,{"v":"Ola"},null,null,null]}
        ]},"parsedNumHeaders":1});
        """;

    [Fact]
    public void Parse_ReadsColumnsByLabel()
    {
        var rows = SheetParser.Parse(Feed);

        Assert.Equal(3, rows.Count); // the empty row is skipped

        var splendor = rows[0];
        Assert.Equal("Splendor marvel", splendor.Title);
        Assert.Equal(TableKind.Small, splendor.Kind);
        Assert.Equal(new TimeOnly(18, 0), splendor.Start);
        Assert.Equal(4, splendor.MaxPlayers);
        Assert.Equal(1.7966m, splendor.Weight); // the raw value, not the rounded "1,80"
        Assert.Equal(3, splendor.TakenSlots);
        Assert.Empty(splendor.Players);

        var grimcoven = rows[1];
        Assert.Equal("Grimcoven", grimcoven.Title);
        Assert.Equal(TableKind.Big, grimcoven.Kind);
        Assert.Null(grimcoven.Start);
        Assert.Equal(0, grimcoven.TakenSlots);
        Assert.Equal(["Patryk Czaja", "Krzysztof P.", "Paweł D."], grimcoven.Players.OrderBy(p => p.Key).Select(p => p.Value));
    }

    [Fact]
    public void Parse_WithoutMax_CountsUpToLastFilledSeat()
    {
        var row = SheetParser.Parse(Feed)[2];

        Assert.Equal(TableKind.Other, row.Kind);
        Assert.Equal(3, row.MaxPlayers);
        Assert.Equal("Ola", row.Players[3]);
    }

    [Theory]
    [InlineData("""{"status":"error"}""")]
    [InlineData("""{"status":"ok","table":{"cols":[{"label":"Odpowiedzi"}],"rows":[]}}""")] // another tab
    [InlineData("not json")]
    public void Parse_RejectsWhatIsNotTheSignUpSheet(string response) =>
        Assert.Throws<SheetFormatException>(() => SheetParser.Parse(response));

    [Fact]
    public void KeysFor_NumbersRepeatedTitles()
    {
        var rows = new[] { Row("Catan"), Row(" catan "), Row("Azul") };

        Assert.Equal(["catan#1", "catan#2", "azul#1"], SheetTableRow.KeysFor(rows));
    }

    internal static SheetTableRow Row(string title, int max = 4, int taken = 0, TimeOnly? start = null, params (int Seat, string Name)[] players) =>
        new(title, TableKind.Small, start, max, 2.5m, taken, players.ToDictionary(p => p.Seat, p => p.Name));
}

/// <summary><see cref="PlayTable.ApplyImport"/>: the sheet owns imported seats, app seats survive.</summary>
public class PlayTableImportTests
{
    private static PlayTable Imported(SheetTableRow row)
    {
        var table = new PlayTable { ImportKey = "x#1" };
        table.ApplyImport(row);
        return table;
    }

    [Fact]
    public void ApplyImport_CopiesRow()
    {
        var table = Imported(SheetParserTests.Row("Catan", max: 4, taken: 1, start: new TimeOnly(18, 0), (1, "Ala"), (2, "Ola")));

        Assert.Equal("Catan", table.GameTitle);
        Assert.Equal(4, table.MaxPlayers);
        Assert.Equal(new TimeOnly(18, 0), TimeOnly.FromDateTime(table.Start));
        Assert.Equal(1, table.TakenSlots);
        Assert.All(table.Participants, p => Assert.True(p.IsImported));
        Assert.Equal(1, table.FreeSlots);
    }

    [Fact]
    public void ApplyImport_RemovesPlayersGoneFromSheet_KeepsAppPlayers()
    {
        var table = Imported(SheetParserTests.Row("Catan", 4, 0, null, (1, "Ala"), (2, "Ola")));
        Assert.True(table.TryTakeSlot(3, "Janek", "janek", out _));

        table.ApplyImport(SheetParserTests.Row("Catan", 4, 0, null, (1, "Ala")));

        Assert.Equal(new Dictionary<int, string> { [1] = "Ala", [3] = "Janek" }, table.Slots);
        Assert.False(table.Participants.Single(p => p.SlotNumber == 3).IsImported);
    }

    [Fact]
    public void ApplyImport_MovesAppPlayerWhenSheetTakesTheirSeat()
    {
        var table = Imported(SheetParserTests.Row("Catan", 4, 0, null, (1, "Ala")));
        Assert.True(table.TryTakeSlot(2, "Janek", "janek", out _));

        var dropped = table.ApplyImport(SheetParserTests.Row("Catan", 4, 0, null, (1, "Ala"), (2, "Ola")));

        Assert.Empty(dropped);
        Assert.Equal("Ola", table.Slots[2]);
        Assert.Equal("Janek", table.Slots[3]);
        Assert.Equal("janek", table.Participants.Single(p => p.SlotNumber == 3).UserId);
    }

    [Fact]
    public void ApplyImport_DropsAppPlayerWhenTableIsFull_AndClampsMarks()
    {
        var table = Imported(SheetParserTests.Row("Catan", 2, 0, null, (1, "Ala")));
        Assert.True(table.TryTakeSlot(2, "Janek", "janek", out _));

        var dropped = table.ApplyImport(SheetParserTests.Row("Catan", 2, 1, null, (1, "Ala"), (2, "Ola")));

        Assert.Equal(["Janek"], dropped);
        Assert.Equal(2, table.ParticipantAmount);
        Assert.Equal(0, table.TakenSlots); // no free seat left to mark
    }

    [Fact]
    public void ApplyImport_KeepsDateWhenHourIsUnchanged()
    {
        var table = Imported(SheetParserTests.Row("Catan", start: new TimeOnly(18, 0)));
        table.Start = new DateTime(2026, 1, 5, 18, 0, 0);

        table.ApplyImport(SheetParserTests.Row("Catan", start: new TimeOnly(18, 0)));

        Assert.Equal(new DateTime(2026, 1, 5, 18, 0, 0), table.Start);
    }
}

/// <summary><see cref="SheetBoardSync"/> against an in-memory SQLite database.</summary>
public sealed class SheetBoardSyncTests : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly ApplicationDbContext _db;

    public SheetBoardSyncTests()
    {
        _connection.Open();
        _db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>().UseSqlite(_connection).Options);
        _db.Database.EnsureCreated();
    }

    private async Task<SheetSyncResult> SyncAsync(params SheetTableRow[] rows)
    {
        var result = await new SheetBoardSync(_db).SyncAsync(rows);
        _db.ChangeTracker.Clear();
        return result;
    }

    [Fact]
    public async Task Sync_MirrorsSheet_AndLeavesAppDataAlone()
    {
        // App data: a BGG game with its own table, and a hand-added game without a weight.
        var catan = new Game { Name = "Catan", MaxPlayers = 4, BggId = 13, Difficulty = 2.3m };
        _db.Games.Add(new Game { Name = "Azul", MaxPlayers = 4 });
        Assert.True(PlayTable.TryCreate(catan, "Catan", TableKind.Small, 4, 0, null, "owner", "Owner", out var appTable, out _));
        _db.PlayTables.Add(appTable);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        var first = await SyncAsync(
            SheetParserTests.Row("catan", 3, 0, null, (1, "Ala")),
            SheetParserTests.Row("Azul", 4, 0, null, (1, "Ola")),
            SheetParserTests.Row("Recall", 4, 0, null, (1, "Ela")));
        Assert.Equal(3, first.Added);

        // Existing games are reused (Catan unchanged; Azul only gets the missing weight); Recall is new.
        var games = await _db.Games.AsNoTracking().OrderBy(g => g.Name).ToListAsync();
        Assert.Equal(["Azul", "Catan", "Recall"], games.Select(g => g.Name));
        Assert.Equal(2.5m, games[0].Difficulty);
        Assert.Equal(2.3m, games[1].Difficulty);
        Assert.True(games[2].IsFromSheet);

        // An app user joins the imported Recall table.
        var recall = await _db.PlayTables.Include(t => t.Participants).SingleAsync(t => t.GameTitle == "Recall");
        Assert.True(recall.TryTakeSlot(2, "Janek", "janek", out _));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();

        // Azul disappears from the sheet; Recall gains a player in Janek's seat.
        var second = await SyncAsync(
            SheetParserTests.Row("catan", 3, 0, null, (1, "Ala")),
            SheetParserTests.Row("Recall", 4, 0, null, (1, "Ela"), (2, "Ula")));
        Assert.Equal((0, 2, 1), (second.Added, second.Updated, second.Removed));

        var tables = await _db.PlayTables.AsNoTracking().Include(t => t.Participants).ToListAsync();
        Assert.Equal(3, tables.Count); // app Catan + imported Catan + Recall
        Assert.Contains(tables, t => t.Id == appTable.Id && t.ImportKey == null && t.Participants.Single().UserId == "owner");
        var recallSeats = tables.Single(t => t.GameTitle == "Recall").Slots;
        Assert.Equal(new Dictionary<int, string> { [1] = "Ela", [2] = "Ula", [3] = "Janek" }, recallSeats);

        // Azul was a catalog game, so it stays; an empty sheet removes every imported table and Recall's game.
        await SyncAsync();
        Assert.Equal([appTable.Id], await _db.PlayTables.Select(t => t.Id).ToListAsync());
        Assert.Equal(["Azul", "Catan"], await _db.Games.OrderBy(g => g.Name).Select(g => g.Name).ToListAsync());
    }

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }
}
