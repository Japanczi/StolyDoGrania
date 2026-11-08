using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Components.Authorization;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Planszowkarz.Components;
using Planszowkarz.Components.Account;
using Planszowkarz.Data;
using Planszowkarz.Data.Bgg;
using Planszowkarz.Data.Email;
using Planszowkarz.Data.Table;
using Planszowkarz.Tools;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorComponents()
    .AddInteractiveServerComponents();

builder.Services.AddCascadingAuthenticationState();
builder.Services.AddScoped<IdentityRedirectManager>();
builder.Services.AddScoped<AuthenticationStateProvider, IdentityRevalidatingAuthenticationStateProvider>();

builder.Services.AddAuthentication(options =>
    {
        options.DefaultScheme = IdentityConstants.ApplicationScheme;
        options.DefaultSignInScheme = IdentityConstants.ExternalScheme;
    });

var connectionString = builder.Configuration.GetConnectionString("DefaultConnection") ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseSqlite(connectionString));
builder.Services.AddDatabaseDeveloperPageExceptionFilter();

builder.Services.AddIdentity<ApplicationUser, IdentityRole>(options =>
    {
        options.SignIn.RequireConfirmedAccount = true;
        options.Stores.SchemaVersion = IdentitySchemaVersions.Version3;

        // User name and e-mail are separate; login accepts either, so e-mails must be unique.
        options.User.RequireUniqueEmail = true;
        options.User.AllowedUserNameCharacters += "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ";

        // Local development only: allows the temporary admin/admin account.
        if (builder.Environment.IsDevelopment())
        {
            options.Password.RequireDigit = false;
            options.Password.RequireLowercase = false;
            options.Password.RequireUppercase = false;
            options.Password.RequireNonAlphanumeric = false;
            options.Password.RequiredLength = 5;

            // Lets the seeded test users have full Polish names as usernames.
            options.User.AllowedUserNameCharacters += " ";
        }
    })
    .AddEntityFrameworkStores<ApplicationDbContext>()
    .AddSignInManager()
    .AddDefaultTokenProviders();

// Real e-mail only when an SMTP host is configured; otherwise the no-op sender keeps the
// "click here to confirm" link on RegisterConfirmation, which local development relies on.
var emailSection = builder.Configuration.GetSection(EmailSettings.SectionName);
builder.Services.Configure<EmailSettings>(emailSection);
if (!string.IsNullOrWhiteSpace(emailSection[nameof(EmailSettings.Host)]))
{
    builder.Services.AddSingleton<IEmailSender<ApplicationUser>, MailKitEmailSender>();
}
else
{
    builder.Services.AddSingleton<IEmailSender<ApplicationUser>, IdentityNoOpEmailSender>();
}

builder.Services.AddSingleton<NormalUserMode>();
builder.Services.AddSingleton<IClaimsTransformation, NormalUserModeClaimsTransformation>();

builder.Services.Configure<TableSettings>(builder.Configuration.GetSection(TableSettings.SectionName));

builder.Services.AddHttpClient(BggClient.HttpClientName, client =>
{
    client.Timeout = TimeSpan.FromSeconds(20);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("Planszowkarz/1.0");
});
builder.Services.AddSingleton<BggClient>();

builder.Services.AddScoped<BoardResetter>();
builder.Services.AddHostedService<WeeklyBoardResetService>();

// In production HTTPS ends at the hosting proxy (Mikrus / Cloudflare), which forwards plain HTTP.
// Trust its X-Forwarded-Proto/For headers so generated links (e.g. confirmation e-mails) use https://.
// The proxy's address isn't known in advance, so the default loopback-only trust list is cleared.
builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
    options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    options.KnownIPNetworks.Clear();
    options.KnownProxies.Clear();
});

var app = builder.Build();

// Must run first, so everything below sees the visitor's real scheme and IP.
app.UseForwardedHeaders();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseMigrationsEndPoint();
    app.MapDesignerEndpoints();
}
else
{
    app.UseExceptionHandler("/Error", createScopeForErrors: true);
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}
app.UseStatusCodePagesWithReExecute("/not-found", createScopeForStatusCodePages: true);
app.UseHttpsRedirection();

app.UseAntiforgery();

app.MapStaticAssets();
app.MapRazorComponents<App>()
    .AddInteractiveServerRenderMode();

// Add additional endpoints required by the Identity /Account Razor components.
app.MapAdditionalIdentityEndpoints();

await IdentitySeeder.SeedAsync(app.Services, app.Configuration);

app.Run();
