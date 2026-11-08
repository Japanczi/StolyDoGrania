using Planszowkarz.Data.Import;

namespace Planszowkarz.Data.Table;

/// <summary>Stół na konkretny termin – gra z katalogu + start + zapisani uczestnicy.</summary>
public class PlayTable
{
    /// <summary>The owner always sits here; taking this slot when it is vacant makes that user the owner.</summary>
    public const int OwnerSlot = 1;

    private int _takenSlots;

    public int Id { get; set; }

    public int GameId { get; set; }
    public Game Game { get; set; } = null!;

    /// <summary>The title as typed when creating the table; null for tables created before this was stored.</summary>
    public string? GameTitle { get; set; }

    /// <summary>The name to show for this table's game.</summary>
    public string DisplayTitle => GameTitle ?? Game.Name;

    /// <summary>Data i godzina rozpoczęcia gry.</summary>
    public DateTime Start { get; set; }

    /// <summary>Liczba miejsc przy stole (domyślnie kopiowana z gry przy tworzeniu stołu).</summary>
    public int MaxPlayers { get; set; }

    /// <summary>Table type chosen by the owner (may differ from the game's default).</summary>
    public TableKind Kind { get; set; } = TableKind.Small;

    /// <summary>Id of the user who created the table; null for tables created before this was tracked.</summary>
    public string? OwnerUserId { get; set; }

    /// <summary>
    /// Identifies the sign-up sheet row this table mirrors (see <see cref="SheetTableRow.KeysFor"/>);
    /// null for tables created in the app, which the import never touches.
    /// </summary>
    public string? ImportKey { get; set; }

    public bool IsImported => ImportKey is not null;

    /// <summary>False when the meeting hour is not set yet (<see cref="Start"/> holds the default value).</summary>
    public bool HasStartTime => Start != default;

    /// <summary>
    /// Liczba miejsc oznaczonych przez operatora stołu jako "Zajęte" (niedostępne do zapisu).
    /// Zajęte są wolne miejsca o najwyższych numerach, z pominięciem miejsc z uczestnikami (<see cref="IsSlotTaken"/>).
    /// Do zmiany po utworzeniu stołu użyj <see cref="TrySetTakenSlots"/>.
    /// </summary>
    public int TakenSlots
    {
        get => _takenSlots;
        set
        {
            ArgumentOutOfRangeException.ThrowIfNegative(value);
            _takenSlots = value;
        }
    }

    /// <summary>Zapisani uczestnicy – trafia do tabeli TableSlots.</summary>
    public List<TableSlot> Participants { get; set; } = new();

    /// <summary>Widok "numer miejsca → nazwa uczestnika" (tylko do odczytu; zmiany przez Join/Leave).</summary>
    public Dictionary<int, string> Slots =>
        Participants.OrderBy(p => p.SlotNumber).ToDictionary(p => p.SlotNumber, p => p.ParticipantName);

    public int ParticipantAmount => Participants.Count;
    public int AvailableSlots => Math.Max(0, MaxPlayers - TakenSlots);
    public int FreeSlots => Math.Max(0, AvailableSlots - ParticipantAmount);
    public bool IsFull => FreeSlots == 0;

    /// <summary>Unoccupied seats that may be marked as taken; a table's owner seat is never one of them.</summary>
    private IEnumerable<int> MarkableSlots =>
        Enumerable.Range(1, MaxPlayers)
            .Where(n => Participants.All(p => p.SlotNumber != n) && (OwnerUserId is null || n != OwnerSlot));

    /// <summary>The largest allowed value of <see cref="TakenSlots"/>.</summary>
    public int MaxTakenSlots => MarkableSlots.Count();

    /// <summary>Marks fill the highest-numbered markable seats, passing over seated players.</summary>
    public bool IsSlotTaken(int slot) => MarkableSlots.OrderDescending().Take(TakenSlots).Contains(slot);

    public bool IsOwner(string? userId) => userId is not null && OwnerUserId == userId;

    /// <summary>
    /// Creates a new table owned by <paramref name="ownerUserId"/>, who is seated in <see cref="OwnerSlot"/>.
    /// The spots limit from settings is checked by the caller.
    /// </summary>
    public static bool TryCreate(
        Game game, string gameTitle, TableKind kind, int maxPlayers, int takenSlots, TimeOnly? hour,
        string ownerUserId, string ownerName,
        [System.Diagnostics.CodeAnalysis.NotNullWhen(true)] out PlayTable? table, out string? error)
    {
        table = null;

        if (maxPlayers < 1)
        {
            error = "Stół musi mieć co najmniej jedno miejsce.";
            return false;
        }

        if (takenSlots < 0 || takenSlots >= maxPlayers)
        {
            error = "Przy stole musi zostać co najmniej jedno miejsce dla Ciebie.";
            return false;
        }

        var created = new PlayTable
        {
            Game = game,
            GameTitle = gameTitle,
            Kind = kind,
            MaxPlayers = maxPlayers,
            TakenSlots = takenSlots,
            OwnerUserId = ownerUserId
        };
        created.SetStartTime(hour);

        if (!created.TryTakeSlot(OwnerSlot, ownerName, ownerUserId, out error))
        {
            return false;
        }

        table = created;
        return true;
    }

    /// <summary>Sets the meeting hour, keeping the existing date; null clears it.</summary>
    public void SetStartTime(TimeOnly? time) =>
        Start = time is { } value
            ? (HasStartTime ? Start.Date : DateTime.Today).Add(value.ToTimeSpan())
            : default;

    /// <summary>
    /// Seats a logged-in user on a chosen slot; each user may hold one seat per table.
    /// Taking <see cref="OwnerSlot"/> makes the user the owner, so a vacated seat hands the table over.
    /// Tables without a owner (created before this was tracked) stay without one.
    /// </summary>
    public bool TryTakeSlot(int slot, string participantName, string userId, out string? error)
    {
        error = null;

        if (slot < 1 || slot > MaxPlayers || IsSlotTaken(slot))
        {
            error = "Nie można zająć tego miejsca.";
            return false;
        }

        if (Participants.Any(p => p.SlotNumber == slot))
        {
            error = "To miejsce zostało właśnie zajęte przez kogoś innego.";
            return false;
        }

        if (Participants.Any(p => p.UserId == userId))
        {
            error = "Masz już miejsce przy tym stole.";
            return false;
        }

        if (IsOwner(userId) && slot != OwnerSlot)
        {
            error = "Jako właściciel stołu możesz zająć tylko pierwsze miejsce.";
            return false;
        }

        if (slot == OwnerSlot && OwnerUserId is not null)
        {
            OwnerUserId = userId;
        }

        Participants.Add(new TableSlot { SlotNumber = slot, ParticipantName = participantName.Trim(), UserId = userId });
        return true;
    }

    public bool TrySetTakenSlots(int count, out string? error)
    {
        error = null;

        if (count < 0 || count > MaxTakenSlots)
        {
            error = $"Liczba zajętych miejsc musi mieścić się w zakresie 0–{MaxTakenSlots}.";
            return false;
        }

        _takenSlots = count;
        return true;
    }

    /// <summary>
    /// Owner's action: seats someone else, either a registered user or a free-text name (null user id).
    /// Using a slot marked as taken lowers the counter by one; the other marks stay where they are.
    /// </summary>
    public bool TryAddPlayer(int slot, string participantName, string? playerUserId, out string? error)
    {
        error = null;
        var name = participantName.Trim();

        if (name.Length is 0 or > 100)
        {
            error = "Nazwa gracza musi mieć od 1 do 100 znaków.";
            return false;
        }

        if (slot == OwnerSlot)
        {
            error = "Pierwsze miejsce jest zarezerwowane dla właściciela stołu.";
            return false;
        }

        if (slot < 1 || slot > MaxPlayers)
        {
            error = "Nie można zająć tego miejsca.";
            return false;
        }

        if (playerUserId is not null && (IsOwner(playerUserId) || Participants.Any(p => p.UserId == playerUserId)))
        {
            error = "Ten gracz ma już miejsce przy tym stole.";
            return false;
        }

        if (Participants.Any(p => p.SlotNumber == slot))
        {
            error = "To miejsce zostało właśnie zajęte przez kogoś innego.";
            return false;
        }

        if (IsSlotTaken(slot))
        {
            _takenSlots--;
        }

        Participants.Add(new TableSlot { SlotNumber = slot, ParticipantName = name, UserId = playerUserId });
        return true;
    }

    /// <summary>
    /// Admin's action: seats a registered user in <see cref="OwnerSlot"/> and makes them the owner.
    /// Whoever sat there leaves the table; a new owner seated elsewhere moves over, keeping one seat per user.
    /// </summary>
    public bool TryAssignOwner(string newOwnerUserId, string participantName, out string? error)
    {
        error = null;
        var name = participantName.Trim();

        if (name.Length is 0 or > 100)
        {
            error = "Nazwa gracza musi mieć od 1 do 100 znaków.";
            return false;
        }

        if (IsSlotTaken(OwnerSlot))
        {
            error = "Pierwsze miejsce jest oznaczone jako zajęte.";
            return false;
        }

        var otherSeat = Participants.FirstOrDefault(p => p.UserId == newOwnerUserId && p.SlotNumber != OwnerSlot);
        if (otherSeat is not null)
        {
            Participants.Remove(otherSeat);
        }

        // The seat is updated rather than replaced: EF can't track a removed and an added row with the same key.
        var ownerSeat = Participants.FirstOrDefault(p => p.SlotNumber == OwnerSlot);
        if (ownerSeat is null)
        {
            Participants.Add(new TableSlot { SlotNumber = OwnerSlot, ParticipantName = name, UserId = newOwnerUserId });
        }
        else
        {
            ownerSeat.ParticipantName = name;
            ownerSeat.UserId = newOwnerUserId;
        }

        OwnerUserId = newOwnerUserId;
        return true;
    }

    /// <summary>
    /// Owner's action: switches the table to another game (or just retitles it), with that game's seat count.
    /// Starts the sign-up over: every player leaves and the marks are cleared; a seated owner keeps the first seat.
    /// </summary>
    public bool TryChangeGame(Game game, string title, int maxPlayers, out string? error)
    {
        error = null;
        var name = title.Trim();

        if (name.Length is 0 or > 200)
        {
            error = "Nazwa gry musi mieć od 1 do 200 znaków.";
            return false;
        }

        if (maxPlayers < 1)
        {
            error = "Gra musi mieć co najmniej jedno miejsce.";
            return false;
        }

        Participants.RemoveAll(p => !(p.SlotNumber == OwnerSlot && IsOwner(p.UserId)));

        Game = game;
        GameTitle = name;
        MaxPlayers = maxPlayers;
        _takenSlots = 0;
        return true;
    }

    /// <summary>
    /// Makes this table match a row of the sign-up sheet: title, table kind, hour, seat count, imported players and
    /// "Zajęte" marks. Seats taken in the app are kept; one whose seat the sheet now gives to someone else, or that is
    /// past the new seat count, moves to the lowest free seat. Returns the names of app players who no longer fit.
    /// The caller sets the game.
    /// </summary>
    public IReadOnlyList<string> ApplyImport(SheetTableRow row)
    {
        GameTitle = row.Title;
        Kind = row.Kind;
        MaxPlayers = row.MaxPlayers;

        // The date isn't in the sheet, so an unchanged hour keeps the stored date.
        var currentHour = HasStartTime ? TimeOnly.FromDateTime(Start) : (TimeOnly?)null;
        if (currentHour != row.Start)
        {
            SetStartTime(row.Start);
        }

        // Desired seats: the sheet's players first, then app players where they sit, then displaced app players.
        var desired = row.Players
            .Where(p => p.Key >= 1 && p.Key <= MaxPlayers)
            .ToDictionary(p => p.Key, p => new TableSlot { SlotNumber = p.Key, ParticipantName = p.Value, IsImported = true });

        var appSeats = Participants.Where(p => !p.IsImported).OrderBy(p => p.SlotNumber).ToList();
        var displaced = new List<TableSlot>();
        foreach (var seat in appSeats)
        {
            if (seat.SlotNumber <= MaxPlayers && !desired.ContainsKey(seat.SlotNumber))
            {
                desired[seat.SlotNumber] = new TableSlot { SlotNumber = seat.SlotNumber, ParticipantName = seat.ParticipantName, UserId = seat.UserId };
            }
            else
            {
                displaced.Add(seat);
            }
        }

        var dropped = new List<string>();
        foreach (var seat in displaced)
        {
            var free = Enumerable.Range(1, MaxPlayers).FirstOrDefault(n => !desired.ContainsKey(n));
            if (free == 0)
            {
                dropped.Add(seat.ParticipantName);
                continue;
            }

            desired[free] = new TableSlot { SlotNumber = free, ParticipantName = seat.ParticipantName, UserId = seat.UserId };
        }

        // Existing rows are updated in place rather than replaced: EF can't track a removed and an added row with the same key.
        foreach (var existing in Participants.ToList())
        {
            if (desired.Remove(existing.SlotNumber, out var wanted))
            {
                existing.ParticipantName = wanted.ParticipantName;
                existing.UserId = wanted.UserId;
                existing.IsImported = wanted.IsImported;
            }
            else
            {
                Participants.Remove(existing);
            }
        }

        Participants.AddRange(desired.Values.OrderBy(s => s.SlotNumber));

        _takenSlots = Math.Min(row.TakenSlots, MaxTakenSlots);
        return dropped;
    }

    public int? Join(string participantName)
    {
        if (string.IsNullOrWhiteSpace(participantName))
            throw new ArgumentException("Nazwa uczestnika nie może być pusta.", nameof(participantName));

        for (var slot = 1; slot <= MaxPlayers; slot++)
        {
            if (!IsSlotTaken(slot) && Participants.All(p => p.SlotNumber != slot))
            {
                Participants.Add(new TableSlot { SlotNumber = slot, ParticipantName = participantName.Trim() });
                return slot;
            }
        }

        return null;
    }

    public bool Leave(int slot)
    {
        var entry = Participants.FirstOrDefault(p => p.SlotNumber == slot);
        return entry is not null && Participants.Remove(entry);
    }
}
