using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using StolyDoGrania.Data.Table;

namespace StolyDoGrania.Data;

public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<Game> Games => Set<Game>();
    public DbSet<GameAlternateName> GameAlternateNames => Set<GameAlternateName>();
    public DbSet<PlayTable> PlayTables => Set<PlayTable>();
    public DbSet<TableSlot> TableSlots => Set<TableSlot>();
    public DbSet<BoardSettings> BoardSettings => Set<BoardSettings>();
    public DbSet<TablePhrase> TablePhrases => Set<TablePhrase>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Game>(e =>
        {
            e.ToTable("Games");
            e.Property(g => g.Name).IsRequired().HasMaxLength(200);
            e.HasIndex(g => g.Name).IsUnique();
            e.Property(g => g.Kind).HasConversion<string>().HasMaxLength(20);
            // BGG weights have four decimal places and are stored unmodified.
            e.Property(g => g.Difficulty).HasPrecision(5, 4);
            e.Property(g => g.BggUrl).HasMaxLength(500);
            e.Property(g => g.CoverContentType).HasMaxLength(100);
            e.HasIndex(g => g.BggId).IsUnique();
            e.HasMany(g => g.AlternateNames)
                .WithOne()
                .HasForeignKey(a => a.GameId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<GameAlternateName>(e =>
        {
            e.ToTable("GameAlternateNames");
            e.HasKey(a => new { a.GameId, a.Name });
            e.Property(a => a.Name).HasMaxLength(500);
        });

        builder.Entity<PlayTable>(e =>
        {
            e.ToTable("PlayTables");
            e.HasKey(t => t.Id);
            // The store default keeps existing rows valid: an empty string would not convert back to the enum.
            e.Property(t => t.Kind).HasConversion<string>().HasMaxLength(20).HasDefaultValue(TableKind.Small);
            e.Property(t => t.OwnerUserId).HasMaxLength(450);
            e.Property(t => t.GameTitle).HasMaxLength(200);
            e.Ignore(t => t.DisplayTitle);
            e.HasOne(t => t.Game)
                .WithMany(g => g.Tables)
                .HasForeignKey(t => t.GameId)
                .OnDelete(DeleteBehavior.Restrict); // nie usuwamy gry, która ma stoły
            e.HasMany(t => t.Participants)
                .WithOne(s => s.PlayTable)
                .HasForeignKey(s => s.PlayTableId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<TableSlot>(e =>
        {
            e.ToTable("TableSlots");
            e.HasKey(s => new { s.PlayTableId, s.SlotNumber });
            e.Property(s => s.ParticipantName).IsRequired().HasMaxLength(100);
            e.Property(s => s.UserId).HasMaxLength(450);
        });

        builder.Entity<TablePhrase>(e =>
        {
            e.ToTable("TablePhrases");
            e.Property(p => p.Phrase).IsRequired().HasMaxLength(TablePhrase.MaxLength);
            e.Property(p => p.UserId).HasMaxLength(450);
            // Newest first is the only query.
            e.HasIndex(p => p.CreatedUtc);
            // The phrase stays when its game is deleted from Baza gier.
            e.HasOne(p => p.Game)
                .WithMany()
                .HasForeignKey(p => p.GameId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        builder.Entity<BoardSettings>(e =>
        {
            e.ToTable("BoardSettings");
            e.Property(s => s.Id).ValueGeneratedNever();
            // The single row exists from the start, so nothing has to create it on first use.
            e.HasData(new { Id = Table.BoardSettings.SingletonId, AutoResetEnabled = false });
        });
    }
}
