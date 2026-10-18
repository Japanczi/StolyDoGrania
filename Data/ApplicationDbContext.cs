using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using StolyDoGrania.Data.Table;

namespace StolyDoGrania.Data;

public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<PlayTable> Tables => Set<PlayTable>();
    public DbSet<TableSlot> TableSlots => Set<TableSlot>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<PlayTable>(e =>
        {
            e.ToTable("Tables");
            e.Property(t => t.Name).IsRequired().HasMaxLength(200);
            e.Property(t => t.Kind).HasConversion<string>().HasMaxLength(20);
            e.Property(t => t.Difficulty).HasPrecision(3, 2);
            e.Property(t => t.BggUrl).HasMaxLength(500);
            e.Property(t => t.CoverContentType).HasMaxLength(100);
            e.HasMany(t => t.Participants)
                .WithOne(s => s.Table)
                .HasForeignKey(s => s.TableId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<TableSlot>(e =>
        {
            e.ToTable("TableSlots");
            e.HasKey(s => new { s.TableId, s.SlotNumber });
            e.Property(s => s.ParticipantName).IsRequired().HasMaxLength(100);
        });
    }
}


