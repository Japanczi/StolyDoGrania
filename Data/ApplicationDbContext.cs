using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using StolyDoGrania.Data.Table;

namespace StolyDoGrania.Data;

public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<Game> Games => Set<Game>();
    public DbSet<PlayTable> PlayTables => Set<PlayTable>();
    public DbSet<TableSlot> TableSlots => Set<TableSlot>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Game>(e =>
        {
            e.ToTable("Games");
            e.Property(g => g.Name).IsRequired().HasMaxLength(200);
            e.HasIndex(g => g.Name).IsUnique();
            e.Property(g => g.Kind).HasConversion<string>().HasMaxLength(20);
            e.Property(g => g.Difficulty).HasPrecision(3, 2);
            e.Property(g => g.BggUrl).HasMaxLength(500);
            e.Property(g => g.CoverContentType).HasMaxLength(100);
        });

        builder.Entity<PlayTable>(e =>
        {
            e.ToTable("PlayTables");
            e.HasKey(t => t.Id);
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
    }
}
