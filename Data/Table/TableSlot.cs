namespace Planszowkarz.Data.Table
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

        /// <summary>
        /// Query filter for slots the user may free: their own slot, any slot at a table they own, or any slot for an admin.
        /// An expression so the check runs in the database query, not only in the UI.
        /// </summary>
        public static System.Linq.Expressions.Expression<Func<TableSlot, bool>> RemovableBy(string userId, bool isAdmin) =>
            s => isAdmin || s.UserId == userId || s.PlayTable.OwnerUserId == userId;
    }
}
