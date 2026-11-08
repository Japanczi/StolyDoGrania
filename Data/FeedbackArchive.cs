using System.IO.Compression;

namespace Planszowkarz.Data;

/// <summary>
/// The folder of user feedback comments (one .md file each), and packing them into a zip for the admin toolbox.
/// Callers check permissions.
/// </summary>
public sealed class FeedbackArchive(IWebHostEnvironment env)
{
    private const string Pattern = "*.md";

    /// <summary>Where <c>FeedbackBox</c> saves comments.</summary>
    public string Folder { get; } = Path.Combine(env.ContentRootPath, "Claude_Resources", "Feedback");

    /// <summary>Number of saved comments.</summary>
    public int Count() => Directory.Exists(Folder) ? Directory.EnumerateFiles(Folder, Pattern).Count() : 0;

    /// <summary>
    /// Zips every comment saved so far. Returns null when there are none.
    /// The listed files are the ones in the zip, so comments saved meanwhile aren't deleted unseen.
    /// </summary>
    public Packed? Pack(DateTime now)
    {
        var files = Directory.Exists(Folder) ? Directory.GetFiles(Folder, Pattern) : [];
        if (files.Length == 0)
        {
            return null;
        }

        using var buffer = new MemoryStream();
        using (var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var file in files)
            {
                zip.CreateEntryFromFile(file, Path.GetFileName(file), CompressionLevel.Optimal);
            }
        }

        return new Packed($"uwagi-{now:yyyyMMdd-HHmmss}.zip", buffer.ToArray(), files);
    }

    /// <summary>Deletes the given comment files; ones already gone are skipped.</summary>
    public void Delete(IEnumerable<string> files)
    {
        foreach (var file in files)
        {
            File.Delete(file);
        }
    }

    /// <param name="FileName">Suggested name of the downloaded zip.</param>
    /// <param name="Zip">The zip's bytes.</param>
    /// <param name="Files">Full paths of the comment files inside it.</param>
    public sealed record Packed(string FileName, byte[] Zip, IReadOnlyList<string> Files);
}
