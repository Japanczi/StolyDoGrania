using Microsoft.Data.Sqlite;

namespace Planszowkarz.Data;

/// <summary>Reads how much disk space the server has and how much the app's data takes. Callers check permissions.</summary>
public sealed class DiskUsage(IWebHostEnvironment env, IConfiguration config, FeedbackArchive feedback)
{
    /// <summary>Measures the disk the app runs from, the database file and the feedback folder.</summary>
    public Report Read()
    {
        var root = env.ContentRootPath;
        // On Linux any path works (statvfs); on Windows DriveInfo wants the drive's root.
        var drive = new DriveInfo(OperatingSystem.IsWindows() ? Path.GetPathRoot(root) ?? root : root);

        return new Report(
            drive.TotalSize,
            drive.AvailableFreeSpace,
            DatabaseBytes(),
            FolderBytes(feedback.Folder),
            DateTime.Now);
    }

    /// <summary>The SQLite file plus its -wal/-shm companions (covers are stored in the database).</summary>
    private long DatabaseBytes()
    {
        var dataSource = new SqliteConnectionStringBuilder(config.GetConnectionString("DefaultConnection")).DataSource;
        if (string.IsNullOrWhiteSpace(dataSource))
        {
            return 0;
        }

        // A relative path is resolved against the working directory, as SQLite itself does.
        var path = Path.GetFullPath(dataSource);
        return new[] { path, path + "-wal", path + "-shm" }.Sum(FileBytes);
    }

    private static long FileBytes(string path)
    {
        var file = new FileInfo(path);
        return file.Exists ? file.Length : 0;
    }

    private static long FolderBytes(string folder) =>
        Directory.Exists(folder)
            ? new DirectoryInfo(folder).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length)
            : 0;

    /// <param name="DriveTotal">Size of the disk, in bytes.</param>
    /// <param name="DriveFree">Space still available to the app, in bytes.</param>
    /// <param name="Database">Size of the database files, in bytes.</param>
    /// <param name="Feedback">Size of the saved feedback comments, in bytes.</param>
    /// <param name="ReadAt">Server's local time of the reading.</param>
    public sealed record Report(long DriveTotal, long DriveFree, long Database, long Feedback, DateTime ReadAt)
    {
        public long DriveUsed => DriveTotal - DriveFree;

        public double UsedPercent => DriveTotal > 0 ? 100.0 * DriveUsed / DriveTotal : 0;
    }
}
