namespace StolyDoGrania.Data.Table;

/// <summary>Rodzaj stołu.</summary>
public enum TableKind
{
    Small,
    Big,
    Other
}

/// <summary>Stół do gry planszowej.</summary>
public class PlayTable
{
    private int _takenSlots;

    public int Id { get; set; }

    /// <summary>Nazwa stołu (np. nazwa gry).</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Rodzaj stołu (mały / duży / inny).</summary>
    public TableKind Kind { get; set; } = TableKind.Other;

    /// <summary>Data i godzina rozpoczęcia gry.</summary>
    public DateTime Start { get; set; }

    /// <summary>Maksymalna liczba graczy (wszystkie miejsca przy stole).</summary>
    public int MaxPlayers { get; set; }

    /// <summary>Link do gry na BoardGameGeek.</summary>
    public Uri? BggUrl { get; set; }

    /// <summary>Poziom trudności (np. "weight" z BGG, skala 1–5).</summary>
    public decimal Difficulty { get; set; }

    /// <summary>Okładka gry jako osadzony obraz (surowe bajty).</summary>
    public byte[]? Cover { get; set; }

    /// <summary>Typ MIME okładki, np. "image/jpeg".</summary>
    public string? CoverContentType { get; set; }

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

    /// <summary>Zapisani uczestnicy – to jest to, co trafia do tabeli TableSlots.</summary>
    public List<TableSlot> Participants { get; set; } = new();

    /// <summary>
    /// Widok "numer miejsca → nazwa uczestnika". Tylko do odczytu;
    /// zmiany robi się przez <see cref="Join"/> i <see cref="Leave"/>.
    /// </summary>
    public Dictionary<int, string> Slots =>
        Participants.OrderBy(p => p.SlotNumber).ToDictionary(p => p.SlotNumber, p => p.ParticipantName);

    /// <summary>Liczba zapisanych uczestników.</summary>
    public int ParticipantAmount => Participants.Count;

    /// <summary>Miejsca dostępne do zapisu (MaxPlayers minus miejsca zajęte przez operatora).</summary>
    public int AvailableSlots => Math.Max(0, MaxPlayers - TakenSlots);

    /// <summary>Miejsca, na które można się jeszcze zapisać.</summary>
    public int FreeSlots => Math.Max(0, AvailableSlots - ParticipantAmount);

    public bool IsFull => FreeSlots == 0;

    /// <summary>Czy dane miejsce jest oznaczone jako "Zajęte" przez operatora.</summary>
    public bool IsSlotTaken(int slot) => slot > AvailableSlots && slot <= MaxPlayers;

    /// <summary>
    /// Ustala liczbę miejsc "Zajęte". Zwraca false (nic nie zmieniając), gdy wartość jest
    /// spoza zakresu 0..MaxPlayers albo kolidowałaby z już zapisanymi uczestnikami.
    /// </summary>
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

    /// <summary>
    /// Zapisuje uczestnika na pierwsze wolne miejsce spośród dostępnych (pomija miejsca "Zajęte").
    /// Zwraca numer miejsca lub null, gdy brak wolnych miejsc.
    /// </summary>
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

    /// <summary>Wypisuje uczestnika z danego miejsca.</summary>
    public bool Leave(int slot)
    {
        var entry = Participants.FirstOrDefault(p => p.SlotNumber == slot);
        return entry is not null && Participants.Remove(entry);
    }
}
