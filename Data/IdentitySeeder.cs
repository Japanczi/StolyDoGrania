using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace StolyDoGrania.Data;

public static class IdentitySeeder
{
    public static async Task SeedAsync(IServiceProvider services, IConfiguration config)
    {
        using var scope = services.CreateScope();
        var sp = scope.ServiceProvider;
        var logger = sp.GetRequiredService<ILoggerFactory>().CreateLogger("IdentitySeeder");

        await sp.GetRequiredService<ApplicationDbContext>().Database.MigrateAsync();

        var roleManager = sp.GetRequiredService<RoleManager<IdentityRole>>();
        var userManager = sp.GetRequiredService<UserManager<ApplicationUser>>();

        foreach (var role in AppRoles.All)
        {
            if (!await roleManager.RoleExistsAsync(role))
                await roleManager.CreateAsync(new IdentityRole(role));
        }

        // Konto admina (dane z konfiguracji / user-secrets)
        var email = config["Admin:Email"];
        var password = config["Admin:Password"];
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            logger.LogWarning("Brak Admin:Email / Admin:Password w konfiguracji – pomijam tworzenie admina.");
        }
        else
        {
            var admin = await userManager.FindByEmailAsync(email);
            if (admin is null)
            {
                admin = new ApplicationUser { UserName = email, Email = email, EmailConfirmed = true };
                var result = await userManager.CreateAsync(admin, password);
                if (!result.Succeeded)
                {
                    logger.LogError("Nie udało się utworzyć admina: {Errors}",
                        string.Join(", ", result.Errors.Select(e => e.Description)));
                    return;
                }
            }

            if (!await userManager.IsInRoleAsync(admin, AppRoles.Admin))
            {
                await userManager.AddToRoleAsync(admin, AppRoles.Admin);
            }
        }

        // Istniejący użytkownicy bez żadnej roli dostają "User"
        foreach (var u in await userManager.Users.ToListAsync())
        {
            if ((await userManager.GetRolesAsync(u)).Count == 0)
                await userManager.AddToRoleAsync(u, AppRoles.User);
        }
    }
}