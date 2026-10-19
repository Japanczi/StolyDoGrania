namespace StolyDoGrania.Data.Table;

/// <summary>Stół na konkretny termin – gra z katalogu + start + zapisani uczestnicy.</summary>
public class PlayTable
{
    private int _takenSlots;

    public int Id { get; set; }

    public int GameId { get; set; }
    public Game Game { get; set; } = null!;

    /// <summary>Data i godzina rozpoczęcia gry.</summary>
    public DateTime Start { get; set; }

    /// <summary>Liczba miejsc przy stole (domyślnie kopiowana z gry przy tworzeniu stołu).</summary>
    public int MaxPlayers { get; set; }

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

    public bool TrySetTakenSlots(int count, out string? error)
    {
        error = null;

        if (count < 0 || count > MaxPlayers)
        {
            error = $"Liczba zajętych miejsc musi mieścić się w zakresie 0–{MaxPlayers}.";
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
