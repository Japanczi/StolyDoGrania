using Microsoft.Extensions.Options;

namespace Planszowkarz.Data.Import;

/// <summary>
/// Imports the Google sign-up sheet into the list of tables at startup and then every
/// <see cref="SheetImportSettings.IntervalMinutes"/> minutes (30 by default). A failed or unreadable download
/// changes nothing, so a broken sheet never empties the board; the next check tries again.
/// Temporary: only bridges the move from the sheet to the app, and is removed once everyone signs up here.
/// </summary>
public sealed class SheetImportService(
    IServiceScopeFactory scopes,
    IHttpClientFactory httpClientFactory,
    IOptions<SheetImportSettings> options,
    ILogger<SheetImportService> logger) : BackgroundService
{
    public const string HttpClientName = "sheet";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var settings = options.Value;
        if (!settings.Enabled || string.IsNullOrWhiteSpace(settings.SourceUrl))
        {
            logger.LogInformation("Sign-up sheet import is off (SheetImport:Enabled / SheetImport:SourceUrl).");
            return;
        }

        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(Math.Max(1, settings.IntervalMinutes)));
        do
        {
            try
            {
                await ImportAsync(settings.SourceUrl, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !stoppingToken.IsCancellationRequested)
            {
                logger.LogError(ex, "Sign-up sheet import failed; it will be retried at the next check.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task ImportAsync(string sourceUrl, CancellationToken cancellationToken)
    {
        var response = await httpClientFactory.CreateClient(HttpClientName).GetStringAsync(sourceUrl, cancellationToken);
        var rows = SheetParser.Parse(response);

        await using var scope = scopes.CreateAsyncScope();
        var sync = scope.ServiceProvider.GetRequiredService<SheetBoardSync>();
        var result = await sync.SyncAsync(rows, cancellationToken);

        logger.LogInformation("Sign-up sheet import: {Added} tables added, {Updated} checked, {Removed} removed.",
            result.Added, result.Updated, result.Removed);
        if (result.DroppedPlayers.Count > 0)
        {
            logger.LogWarning("Sign-up sheet import: no seat left for app players {Players}.", string.Join(", ", result.DroppedPlayers));
        }
    }
}
