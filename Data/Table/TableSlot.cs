using StolyDoGrania.Data.Table;

namespace StolyDoGrania;

/// <summary>Jeden zapisany uczestnik na konkretnym miejscu przy stole (tabela TableSlots).</summary>
public class TableSlot
{
    public int TableId { get; set; }
    public PlayTable Table { get; set; } = null!;

    /// <summary>Numer miejsca (1..MaxPlayers).</summary>
    public int SlotNumber { get; set; }

    public string ParticipantName { get; set; } = string.Empty;
}
