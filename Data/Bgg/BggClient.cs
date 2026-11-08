using System.Globalization;
using System.Net.Http.Headers;
using System.Xml;
using System.Xml.Linq;
using Planszowkarz.Data.Table;

namespace Planszowkarz.Data.Bgg;

public sealed record BggSearchResult(int Id, string Name, int? Year);

/// <param name="Weight">BGG's average weight (complexity), unmodified; 0 means nobody has rated it yet.</param>
/// <param name="MaxPlayers">0 means BGG doesn't state a player count.</param>
public sealed record BggGameDetails(
    int Id,
    string Name,
    IReadOnlyList<string> AlternateNames,
    int? Year,
    int MaxPlayers,
    decimal Weight,
    Uri? ThumbnailUrl);

public sealed record BggCover(byte[] Bytes, string ContentType);

/// <summary>BGG couldn't be reached or refused the request (throttling, a bad token, an unreadable response).</summary>
public sealed class BggUnavailableException(string message, Exception? innerException = null)
    : Exception(message, innerException);

/// <summary>
/// Server-side client for the BGG XML API. Registered as a singleton, because the request
/// throttling has to be shared by all users. The token comes from the "Bgg:Token" configuration key.
/// </summary>
public sealed class BggClient(IHttpClientFactory httpClientFactory, IConfiguration configuration)
{
    public const string HttpClientName = "bgg";

    private const string ApiRoot = "https://boardgamegeek.com/xmlapi2/";

    // BGG's wiki: "Currently, a 5-second wait between requests seems to suffice."
    private static readonly TimeSpan MinRequestInterval = TimeSpan.FromSeconds(5);

    private readonly SemaphoreSlim _requestGate = new(1, 1);
    private DateTime _nextRequestAtUtc = DateTime.MinValue;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(configuration["Bgg:Token"]);

    /// <summary>Searches board games by name; BGG matches primary and alternate names alike.</summary>
    public async Task<IReadOnlyList<BggSearchResult>> SearchAsync(string query)
    {
        var encodedQuery = Uri.EscapeDataString(query.Trim()).Replace("%20", "+");
        var document = await GetXmlAsync($"search?query={encodedQuery}&type=boardgame");
        return ParseSearchResults(document);
    }

    /// <returns>The game, or null when BGG has no item with this id.</returns>
    public async Task<BggGameDetails?> GetGameAsync(int bggId)
    {
        var document = await GetXmlAsync(FormattableString.Invariant($"thing?id={bggId}&stats=1"));
        return ParseGameDetails(document);
    }

    /// <summary>Downloads a cover from BGG's image host. A cover is optional, so any failure just returns null.</summary>
    public async Task<BggCover?> DownloadCoverAsync(Uri url)
    {
        if (url.Scheme != Uri.UriSchemeHttps || !url.Host.EndsWith(".geekdo-images.com", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        try
        {
            // No Authorization header: the token is only meant for the XML API.
            using var response = await httpClientFactory.CreateClient(HttpClientName)
                .GetAsync(url, HttpCompletionOption.ResponseHeadersRead);

            var contentType = response.Content.Headers.ContentType?.MediaType;
            if (!response.IsSuccessStatusCode
                || contentType is null
                || !Game.AllowedCoverTypes.Contains(contentType)
                || response.Content.Headers.ContentLength > Game.MaxCoverBytes)
            {
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync();
            using var buffer = new MemoryStream();
            var chunk = new byte[81920];
            int read;
            while ((read = await stream.ReadAsync(chunk)) > 0)
            {
                buffer.Write(chunk, 0, read);
                if (buffer.Length > Game.MaxCoverBytes)
                {
                    return null;
                }
            }

            return buffer.Length > 0 ? new BggCover(buffer.ToArray(), contentType) : null;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException)
        {
            return null;
        }
    }

    private async Task<XDocument> GetXmlAsync(string relativeUrl)
    {
        var token = configuration["Bgg:Token"];
        if (string.IsNullOrWhiteSpace(token))
        {
            throw new BggUnavailableException("Missing Bgg:Token configuration.");
        }

        await _requestGate.WaitAsync();
        try
        {
            var delay = _nextRequestAtUtc - DateTime.UtcNow;
            if (delay > TimeSpan.Zero)
            {
                await Task.Delay(delay);
            }

            using var request = new HttpRequestMessage(HttpMethod.Get, ApiRoot + relativeUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Trim());

            using var response = await httpClientFactory.CreateClient(HttpClientName).SendAsync(request);

            // Anything else (401, 429, a throttling 500/503, a queued 202) leaves us without data.
            if (response.StatusCode != System.Net.HttpStatusCode.OK)
            {
                throw new BggUnavailableException($"BGG answered with status {(int)response.StatusCode}.");
            }

            await using var stream = await response.Content.ReadAsStreamAsync();
            using var reader = XmlReader.Create(stream, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null });
            return XDocument.Load(reader);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException or XmlException)
        {
            throw new BggUnavailableException("BGG request failed.", e);
        }
        finally
        {
            _nextRequestAtUtc = DateTime.UtcNow + MinRequestInterval;
            _requestGate.Release();
        }
    }

    internal static IReadOnlyList<BggSearchResult> ParseSearchResults(XDocument document) =>
        document.Root?.Elements("item")
            .Select(item => new BggSearchResult(
                IntAttribute(item, "id") ?? 0,
                ((string?)item.Element("name")?.Attribute("value"))?.Trim() ?? string.Empty,
                ValueOf(item, "yearpublished")))
            .Where(r => r.Id > 0 && r.Name.Length > 0)
            .DistinctBy(r => r.Id)
            .ToList() ?? [];

    internal static BggGameDetails? ParseGameDetails(XDocument document)
    {
        var item = document.Root?.Element("item");
        var id = item is null ? null : IntAttribute(item, "id");
        if (item is null || id is null)
        {
            return null;
        }

        var names = item.Elements("name")
            .Select(n => (Type: (string?)n.Attribute("type"), Value: ((string?)n.Attribute("value"))?.Trim()))
            .Where(n => !string.IsNullOrEmpty(n.Value))
            .ToList();

        var primary = names.FirstOrDefault(n => n.Type == "primary").Value;
        if (primary is null)
        {
            return null;
        }

        var alternates = names
            .Where(n => n.Type != "primary")
            .Select(n => n.Value!)
            .Where(n => !string.Equals(n, primary, StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var weightText = (string?)item.Element("statistics")?.Element("ratings")?.Element("averageweight")?.Attribute("value");
        var weight = decimal.TryParse(weightText, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsedWeight) ? parsedWeight : 0m;

        var thumbnail = ((string?)item.Element("thumbnail"))?.Trim();

        return new BggGameDetails(
            id.Value,
            primary,
            alternates,
            ValueOf(item, "yearpublished"),
            ValueOf(item, "maxplayers") ?? 0,
            weight,
            Uri.TryCreate(thumbnail, UriKind.Absolute, out var thumbnailUrl) ? thumbnailUrl : null);
    }

    private static int? IntAttribute(XElement element, string attribute) =>
        int.TryParse((string?)element.Attribute(attribute), NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) ? value : null;

    private static int? ValueOf(XElement item, string child) =>
        item.Element(child) is { } element ? IntAttribute(element, "value") : null;
}
