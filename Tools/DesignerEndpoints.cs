using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StolyDoGrania.Tools;

/// <summary>
/// Backend of the page designer (wwwroot/tools/designer.js). Must only be mapped in Development,
/// because it writes request data to the project folder.
/// </summary>
public static partial class DesignerEndpoints
{
    private const string DesignsFolder = "Claude_Resources/Tools/Designs";
    private const int MaxSlugLength = 60;

    private static readonly JsonSerializerOptions FileFormat = new()
    {
        WriteIndented = true,
        // The output is a local file, not HTML, so Polish characters can stay readable.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    /// <summary>
    /// Maps the save endpoint. JSON body binding rejects other content types, which keeps
    /// cross-site form posts out without needing an antiforgery token.
    /// </summary>
    public static void MapDesignerEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost("/_designer/save", async (JsonDocument design, IWebHostEnvironment env) =>
        {
            var page = design.RootElement.TryGetProperty("page", out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
            var fileName = $"{DateTime.Now:yyyyMMdd-HHmmss}-{ToSlug(page)}.json";

            try
            {
                var folder = Path.Combine(env.ContentRootPath, DesignsFolder);
                Directory.CreateDirectory(folder);
                await File.WriteAllTextAsync(
                    Path.Combine(folder, fileName),
                    JsonSerializer.Serialize(design.RootElement, FileFormat));
            }
            catch (IOException)
            {
                return Results.Problem("Nie udało się zapisać projektu.");
            }

            return Results.Ok(new { file = $"{DesignsFolder}/{fileName}" });
        });
    }

    /// <summary>Reduces a page path to a safe file name fragment, e.g. "/stoly?x=1" to "stoly-x-1".</summary>
    private static string ToSlug(string? page)
    {
        var slug = NonSlugCharacters().Replace((page ?? string.Empty).ToLowerInvariant(), "-").Trim('-');
        if (slug.Length > MaxSlugLength)
        {
            slug = slug[..MaxSlugLength].TrimEnd('-');
        }

        return slug.Length == 0 ? "root" : slug;
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonSlugCharacters();
}
