using Planszowkarz.Data.Table;

namespace Planszowkarz.Tests;

/// <summary>Pure domain rules of <see cref="PlayTable"/>: no database, no UI.</summary>
public class PlayTableTests
{
    private static readonly Game TestGame = new() { Id = 1, Name = "Catan", MaxPlayers = 4 };

    private static PlayTable CreateTable(int maxPlayers = 4, int takenSlots = 0, string ownerId = "owner")
    {
        Assert.True(PlayTable.TryCreate(TestGame, "Catan", TableKind.Small, maxPlayers, takenSlots, null,
            ownerId, "Owner", out var table, out var error), error);
        return table;
    }

    [Fact]
    public void TryCreate_SeatsOwnerInFirstSlot()
    {
        var table = CreateTable();

        Assert.Equal("owner", table.OwnerUserId);
        var seat = Assert.Single(table.Participants);
        Assert.Equal(PlayTable.OwnerSlot, seat.SlotNumber);
        Assert.Equal("owner", seat.UserId);
    }

    [Theory]
    [InlineData(0, 0)]   // no seats at all
    [InlineData(4, 4)]   // every seat marked as taken: no room for the owner
    [InlineData(4, -1)]
    public void TryCreate_RejectsInvalidSeatCounts(int maxPlayers, int takenSlots)
    {
        var ok = PlayTable.TryCreate(TestGame, "Catan", TableKind.Small, maxPlayers, takenSlots, null,
            "owner", "Owner", out var table, out var error);

        Assert.False(ok);
        Assert.Null(table);
        Assert.False(string.IsNullOrEmpty(error));
    }

    [Fact]
    public void TakenSlots_FillHighestNumberedSeats_AndNeverTheOwnerSeat()
    {
        var table = CreateTable(maxPlayers: 4, takenSlots: 2);

        Assert.True(table.IsSlotTaken(4));
        Assert.True(table.IsSlotTaken(3));
        Assert.False(table.IsSlotTaken(2));
        Assert.False(table.IsSlotTaken(PlayTable.OwnerSlot));
        Assert.Equal(1, table.FreeSlots); // 4 seats - 2 marked - owner
    }

    [Fact]
    public void TakenSlots_SkipSeatedPlayers()
    {
        var table = CreateTable(maxPlayers: 4);
        Assert.True(table.TryTakeSlot(4, "Ala", "ala", out _));

        Assert.True(table.TrySetTakenSlots(1, out _));

        Assert.False(table.IsSlotTaken(4)); // Ala sits there
        Assert.True(table.IsSlotTaken(3));
    }

    [Fact]
    public void TrySetTakenSlots_RejectsMoreThanMarkableSeats()
    {
        var table = CreateTable(maxPlayers: 4);

        Assert.Equal(3, table.MaxTakenSlots);
        Assert.False(table.TrySetTakenSlots(4, out var error));
        Assert.NotNull(error);
        Assert.Equal(0, table.TakenSlots);
    }

    [Fact]
    public void TryTakeSlot_AllowsOneSeatPerUser()
    {
        var table = CreateTable();
        Assert.True(table.TryTakeSlot(2, "Ala", "ala", out _));

        Assert.False(table.TryTakeSlot(3, "Ala", "ala", out var error));
        Assert.Equal("Masz już miejsce przy tym stole.", error);
    }

    [Fact]
    public void TryTakeSlot_RejectsOccupiedAndMarkedSeats()
    {
        var table = CreateTable(maxPlayers: 4, takenSlots: 1);
        Assert.True(table.TryTakeSlot(2, "Ala", "ala", out _));

        Assert.False(table.TryTakeSlot(2, "Ola", "ola", out _)); // occupied
        Assert.False(table.TryTakeSlot(4, "Ola", "ola", out _)); // marked as taken
        Assert.False(table.TryTakeSlot(5, "Ola", "ola", out _)); // out of range
    }

    [Fact]
    public void TryTakeSlot_VacantOwnerSeat_HandsTableOver()
    {
        var table = CreateTable();
        Assert.True(table.Leave(PlayTable.OwnerSlot));

        Assert.True(table.TryTakeSlot(PlayTable.OwnerSlot, "Ala", "ala", out _));

        Assert.Equal("ala", table.OwnerUserId);
    }

    [Fact]
    public void TryAddPlayer_OnMarkedSeat_LowersTakenCounter()
    {
        var table = CreateTable(maxPlayers: 4, takenSlots: 2);

        Assert.True(table.TryAddPlayer(4, "Gość", null, out _));

        Assert.Equal(1, table.TakenSlots);
        Assert.True(table.IsSlotTaken(3));
    }

    [Fact]
    public void TryAddPlayer_CannotUseOwnerSeat()
    {
        var table = CreateTable();
        table.Leave(PlayTable.OwnerSlot);

        Assert.False(table.TryAddPlayer(PlayTable.OwnerSlot, "Gość", null, out _));
    }

    [Fact]
    public void TryAssignOwner_MovesNewOwnerToFirstSeat()
    {
        var table = CreateTable();
        Assert.True(table.TryTakeSlot(3, "Ala", "ala", out _));

        Assert.True(table.TryAssignOwner("ala", "Ala", out _));

        Assert.Equal("ala", table.OwnerUserId);
        var seat = Assert.Single(table.Participants);
        Assert.Equal(PlayTable.OwnerSlot, seat.SlotNumber);
        Assert.Equal("ala", seat.UserId);
    }

    [Fact]
    public void TryChangeGame_ClearsPlayersButKeepsOwner()
    {
        var table = CreateTable(maxPlayers: 4, takenSlots: 1);
        table.TryTakeSlot(2, "Ala", "ala", out _);
        var other = new Game { Id = 2, Name = "Azul", MaxPlayers = 6 };

        Assert.True(table.TryChangeGame(other, "  Azul ", 6, out _));

        Assert.Equal("Azul", table.DisplayTitle);
        Assert.Equal(6, table.MaxPlayers);
        Assert.Equal(0, table.TakenSlots);
        Assert.Equal("owner", Assert.Single(table.Participants).UserId);
    }

    [Fact]
    public void Join_UsesFirstFreeUnmarkedSeat_AndReturnsNullWhenFull()
    {
        var table = CreateTable(maxPlayers: 3, takenSlots: 1);

        Assert.Equal(2, table.Join("Gość"));
        Assert.Null(table.Join("Drugi gość")); // seat 3 is marked as taken
        Assert.True(table.IsFull);
    }
}
