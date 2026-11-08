using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Planszowkarz.Data;
using Planszowkarz.Data.Table;

namespace Planszowkarz.Tests;

/// <summary>Role rules from CLAUDE.md: nobody manages the Owner, only the Owner manages other admins.</summary>
public class RoleRulesTests
{
    [Theory]
    [InlineData(AppRoles.Owner, true, false)]
    [InlineData(AppRoles.Owner, false, false)]
    [InlineData(AppRoles.Admin, true, true)]
    [InlineData(AppRoles.Admin, false, false)]
    [InlineData(AppRoles.User, false, true)]
    public void CanManage(string targetRole, bool actorIsOwner, bool expected) =>
        Assert.Equal(expected, AppRoles.CanManage(targetRole, actorIsOwner));

    [Theory]
    [InlineData(new[] { AppRoles.Admin, AppRoles.Owner }, AppRoles.Owner)]
    [InlineData(new[] { AppRoles.User, AppRoles.Admin }, AppRoles.Admin)]
    [InlineData(new[] { AppRoles.User }, AppRoles.User)]
    [InlineData(new string[0], AppRoles.User)]
    public void MainRole_PicksHighestRole(string[] roles, string expected) =>
        Assert.Equal(expected, AppRoles.MainRole(roles));
}

/// <summary>
/// Slot-removal rule, run as a real query against an in-memory SQLite database, so the check is proven
/// to work on the server side (and to translate to SQL), not just in the UI.
/// </summary>
public sealed class SlotRemovalTests : IDisposable
{
    private readonly SqliteConnection _connection = new("DataSource=:memory:");
    private readonly ApplicationDbContext _db;
    private readonly int _tableId;

    public SlotRemovalTests()
    {
        _connection.Open();
        _db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>().UseSqlite(_connection).Options);
        _db.Database.EnsureCreated();

        // Table owned by "owner" (slot 1), with "ala" in slot 2 and a guest without an account in slot 3.
        var game = new Game { Name = "Catan", MaxPlayers = 4 };
        Assert.True(PlayTable.TryCreate(game, "Catan", TableKind.Small, 4, 0, null, "owner", "Owner", out var table, out _));
        Assert.True(table.TryTakeSlot(2, "Ala", "ala", out _));
        Assert.True(table.TryAddPlayer(3, "Gość", null, out _));
        _db.PlayTables.Add(table);
        _db.SaveChanges();
        _tableId = table.Id;
        _db.ChangeTracker.Clear();
    }

    private int[] RemovableSlots(string userId, bool isAdmin) =>
        _db.TableSlots.AsNoTracking()
            .Where(s => s.PlayTableId == _tableId)
            .Where(TableSlot.RemovableBy(userId, isAdmin))
            .Select(s => s.SlotNumber)
            .OrderBy(n => n)
            .ToArray();

    [Fact]
    public void Player_CanRemoveOnlyOwnSlot() =>
        Assert.Equal([2], RemovableSlots("ala", isAdmin: false));

    [Fact]
    public void TableOwner_CanRemoveAnySlotAtOwnTable() =>
        Assert.Equal([1, 2, 3], RemovableSlots("owner", isAdmin: false));

    [Fact]
    public void Stranger_CannotRemoveAnything() =>
        Assert.Empty(RemovableSlots("someone-else", isAdmin: false));

    [Fact]
    public void Admin_CanRemoveAnySlot() =>
        Assert.Equal([1, 2, 3], RemovableSlots("admin", isAdmin: true));

    public void Dispose()
    {
        _db.Dispose();
        _connection.Dispose();
    }
}
