namespace StolyDoGrania.Data.Table;

/// <summary>
/// Clears the list of tables every Monday at midnight, server time, while the admin toolbox's "Auto" switch is on.
/// Checks once a minute, and once right at startup, which catches up on a Monday missed while the app was down.
/// </summary>
public sealed class WeeklyBoardResetService(IServiceScopeFactory scopes, ILogger<WeeklyBoardResetService> logger) : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(CheckInterval);
        do
        {
            try
            {
                await ResetIfDueAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "The weekly reset of the list of tables failed; it will be retried at the next check.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task ResetIfDueAsync(CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
        var resetter = scope.ServiceProvider.GetRequiredService<BoardResetter>();

        var settings = await resetter.GetSettingsAsync(cancellationToken);
        var now = DateTime.UtcNow;
        if (!settings.IsAutoResetDue(now, TimeZoneInfo.Local))
        {
            return;
        }

        // One transaction, so a reset is never recorded without having happened, or the other way round.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
        var removed = await resetter.ClearTablesAsync(cancellationToken);
        settings.MarkAutoReset(now);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        logger.LogInformation("Weekly reset: removed {Count} tables.", removed);
    }
}
