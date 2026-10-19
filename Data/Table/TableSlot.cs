namespace StolyDoGrania.Data.Table
{
    /// <summary>Jeden zapisany uczestnik na konkretnym miejscu przy stole (tabela TableSlots).</summary>
    public class TableSlot
    {
        public int PlayTableId { get; set; }
        public PlayTable PlayTable { get; set; } = null!;

        /// <summary>Numer miejsca (1..MaxPlayers).</summary>
        public int SlotNumber { get; set; }

        /// <summary>Nazwa wyświetlana przy miejscu.</summary>
        public string ParticipantName { get; set; } = string.Empty;

        /// <summary>Id zalogowanego użytkownika, który zajął to miejsce (tylko on może je zwolnić).</summary>
        public string? UserId { get; set; }
    }
}
