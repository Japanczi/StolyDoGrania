using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Planszowkarz.Data;

public static class IdentitySeeder
{
    private const string TestUserPassword = "gracz";

    // A mix of short and long names, for checking how the UI scales.
    private static readonly string[] TestUserNames =
    [
        "Jan Nowak",
        "Zofia Wiśniewska",
        "Grzegorz Brzęczyszczykiewicz",
        "Małgorzata Szczepańska-Dąbrowska"
    ];

    private static async Task SeedTestUsersAsync(UserManager<ApplicationUser> userManager, ILogger logger)
    {
        for (var i = 0; i < TestUserNames.Length; i++)
        {
            if (await userManager.FindByNameAsync(TestUserNames[i]) is not null)
            {
                continue;
            }

            var user = new ApplicationUser { UserName = TestUserNames[i], Email = $"gracz{i + 1}@example.com", EmailConfirmed = true };
            var result = await userManager.CreateAsync(user, TestUserPassword);
            if (!result.Succeeded)
            {
                logger.LogError("Nie udało się utworzyć użytkownika testowego {Name}: {Errors}",
                    TestUserNames[i], string.Join(", ", result.Errors.Select(e => e.Description)));
            }
        }
    }

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

        // Admin account (values come from configuration / user-secrets)
        var userName = config["Admin:UserName"];
        var email = config["Admin:Email"];
        var password = config["Admin:Password"];
        if (string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
        {
            logger.LogWarning("Brak Admin:UserName / Admin:Email / Admin:Password w konfiguracji – pomijam tworzenie admina.");
        }
        else
        {
            var admin = await userManager.FindByNameAsync(userName);
            if (admin is null)
            {
                admin = new ApplicationUser { UserName = userName, Email = email, EmailConfirmed = true };
                var result = await userManager.CreateAsync(admin, password);
                if (!result.Succeeded)
                {
                    logger.LogError("Nie udało się utworzyć admina: {Errors}",
                        string.Join(", ", result.Errors.Select(e => e.Description)));
                    return;
                }
            }

            // The configured admin is the main admin (Owner), which always comes with Admin.
            foreach (var role in new[] { AppRoles.Admin, AppRoles.Owner })
            {
                if (!await userManager.IsInRoleAsync(admin, role))
                {
                    await userManager.AddToRoleAsync(admin, role);
                }
            }
        }

        // Development only: these accounts have a publicly known password.
        if (sp.GetRequiredService<IHostEnvironment>().IsDevelopment())
        {
            await SeedTestUsersAsync(userManager, logger);
        }

        // Istniejący użytkownicy bez żadnej roli dostają "User"
        foreach (var u in await userManager.Users.ToListAsync())
        {
            if ((await userManager.GetRolesAsync(u)).Count == 0)
                await userManager.AddToRoleAsync(u, AppRoles.User);
        }
    }
}