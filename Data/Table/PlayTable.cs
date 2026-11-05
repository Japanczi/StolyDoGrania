namespace StolyDoGrania.Data.Table;

/// <summary>Stół na konkretny termin – gra z katalogu + start + zapisani uczestnicy.</summary>
public class PlayTable
{
    /// <summary>The owner always sits here; taking this slot when it is vacant makes that user the owner.</summary>
    public const int OwnerSlot = 1;

    private int _takenSlots;

    public int Id { get; set; }

    public int GameId { get; set; }
    public Game Game { get; set; } = null!;

    /// <summary>Data i godzina rozpoczęcia gry.</summary>
    public DateTime Start { get; set; }

    /// <summary>Liczba miejsc przy stole (domyślnie kopiowana z gry przy tworzeniu stołu).</summary>
    public int MaxPlayers { get; set; }

    /// <summary>Table type chosen by the owner (may differ from the game's default).</summary>
    public TableKind Kind { get; set; } = TableKind.Small;

    /// <summary>Id of the user who created the table; null for tables created before this was tracked.</summary>
    public string? OwnerUserId { get; set; }

    /// <summary>False when the meeting hour is not set yet (<see cref="Start"/> holds the default value).</summary>
    public bool HasStartTime => Start != default;

    /// <summary>
    /// Liczba miejsc oznaczonych przez operatora stołu jako "Zajęte" (niedostępne do zapisu).
    /// Zajęte są miejsca o najwyższych numerach: (AvailableSlots + 1)..MaxPlayers.
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

    public bool IsSlotTaken(int slot) => slot > AvailableSlots && slot <= MaxPlayers;

    public bool IsOwner(string? userId) => userId is not null && OwnerUserId == userId;

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

        if (slot < 1 || slot > AvailableSlots)
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

        if (count < 0 || count > MaxPlayers)
        {
            error = $"Liczba zajętych miejsc musi mieścić się w zakresie 0–{MaxPlayers}.";
            return false;
        }

        if (OwnerUserId is not null && count == MaxPlayers)
        {
            error = "Pierwsze miejsce musi pozostać dostępne dla właściciela stołu.";
            return false;
        }

        var newAvailable = MaxPlayers - count;
        if (Participants.Any(p => p.SlotNumber > newAvailable))
        {
            error = "Zajęte miejsca kolidowałyby z już zapisanymi uczestnikami – najpierw ich wypisz.";
            return false;
        }

        _takenSlots = count;
        return true;
    }

    /// <summary>
    /// Owner's action: seats someone else, either a registered user or a free-text name (null user id).
    /// A slot marked as taken gets released; since marked slots are always the highest-numbered,
    /// the player lands on the lowest marked slot rather than necessarily the one that was chosen.
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

        var isMarked = IsSlotTaken(slot);
        if (!isMarked && Participants.Any(p => p.SlotNumber == slot))
        {
            error = "To miejsce zostało właśnie zajęte przez kogoś innego.";
            return false;
        }

        if (isMarked)
        {
            slot = AvailableSlots + 1;
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

    public int? Join(string participantName)
    {
        if (string.IsNullOrWhiteSpace(participantName))
            throw new ArgumentException("Nazwa uczestnika nie może być pusta.", nameof(participantName));

        for (var slot = 1; slot <= AvailableSlots; slot++)
        {
            if (Participants.All(p => p.SlotNumber != slot))
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
