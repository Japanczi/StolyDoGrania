using Microsoft.EntityFrameworkCore;
using Planszowkarz.Data.Table;

namespace Planszowkarz.Data.Import;

public sealed record SheetSyncResult(int Added, int Updated, int Removed, IReadOnlyList<string> DroppedPlayers);

/// <summary>
/// Makes the imported tables match the sign-up sheet 1:1: adds new rows, updates changed ones and removes tables
/// whose row is gone. Tables created in the app, and seats taken in the app, are left alone (see <see cref="PlayTable.ApplyImport"/>).
/// </summary>
public sealed class SheetBoardSync(ApplicationDbContext db)
{
    public async Task<SheetSyncResult> SyncAsync(IReadOnlyList<SheetTableRow> rows, CancellationToken cancellationToken = default)
    {
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        var tables = await db.PlayTables
            .Include(t => t.Participants)
            .Where(t => t.ImportKey != null)
            .ToDictionaryAsync(t => t.ImportKey!, cancellationToken); // ! — the query keeps only non-null keys

        // Names only: loading whole games would load every cover.
        var catalog = await db.Games.AsNoTracking()
            .Select(g => new { g.Id, g.Name, g.Difficulty, AlternateNames = g.AlternateNames.Select(a => a.Name).ToList() })
            .ToListAsync(cancellationToken);
        var newGames = new Dictionary<string, Game>(StringComparer.OrdinalIgnoreCase);

        int added = 0, updated = 0;
        var dropped = new List<string>();
        var keys = SheetTableRow.KeysFor(rows);

        for (var i = 0; i < rows.Count; i++)
        {
            var row = rows[i];
            if (!tables.Remove(keys[i], out var table))
            {
                table = new PlayTable { ImportKey = keys[i] };
                db.PlayTables.Add(table);
                added++;
            }
            else
            {
                updated++;
            }

            // A catalog game of that name (or alternate name) is reused untouched, apart from filling in a missing weight.
            var known = catalog.FirstOrDefault(g => string.Equals(g.Name, row.Title, StringComparison.OrdinalIgnoreCase))
                ?? catalog.FirstOrDefault(g => g.AlternateNames.Contains(row.Title, StringComparer.OrdinalIgnoreCase));
            if (known is not null)
            {
                table.GameId = known.Id;
                if (known.Difficulty == 0 && row.Weight > 0)
                {
                    await db.Games.Where(g => g.Id == known.Id && g.Difficulty == 0)
                        .ExecuteUpdateAsync(s => s.SetProperty(g => g.Difficulty, row.Weight), cancellationToken);
                }
            }
            else
            {
                if (!newGames.TryGetValue(row.Title, out var game))
                {
                    game = new Game
                    {
                        Name = row.Title,
                        Kind = row.Kind,
                        MaxPlayers = row.MaxPlayers,
                        Difficulty = row.Weight,
                        IsFromSheet = true
                    };
                    newGames[row.Title] = game;
                    db.Games.Add(game);
                }

                table.Game = game;
            }

            table.ImportOrder = i;
            dropped.AddRange(table.ApplyImport(row));
        }

        // Whatever is left has no row in the sheet any more, app players included.
        db.PlayTables.RemoveRange(tables.Values);
        await db.SaveChangesAsync(cancellationToken);

        // Games the import added and nothing uses any more leave the catalog with their tables.
        await db.Games.Where(g => g.IsFromSheet && !g.Tables.Any()).ExecuteDeleteAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return new SheetSyncResult(added, updated, tables.Count, dropped);
    }
}
