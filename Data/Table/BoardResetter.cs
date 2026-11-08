using Microsoft.EntityFrameworkCore;

namespace StolyDoGrania.Data.Table;

/// <summary>Clears the list of tables, for the admin toolbox and the weekly automatic reset. Callers check permissions.</summary>
public sealed class BoardResetter(ApplicationDbContext db)
{
    /// <summary>Removes every table and its seats; games stay in the catalog. Returns the number of tables removed.</summary>
    public async Task<int> ClearTablesAsync(CancellationToken cancellationToken = default)
    {
        // Joins the caller's transaction when there is one, so the caller can commit related changes with it.
        await using var transaction = db.Database.CurrentTransaction is null
            ? await db.Database.BeginTransactionAsync(cancellationToken)
            : null;

        await db.TableSlots.ExecuteDeleteAsync(cancellationToken);
        var removed = await db.PlayTables.ExecuteDeleteAsync(cancellationToken);

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        return removed;
    }

    /// <summary>The settings row, tracked so changes can be saved. The row is seeded by the AddBoardSettings migration.</summary>
    public Task<BoardSettings> GetSettingsAsync(CancellationToken cancellationToken = default) =>
        db.BoardSettings.SingleAsync(s => s.Id == BoardSettings.SingletonId, cancellationToken);
}
