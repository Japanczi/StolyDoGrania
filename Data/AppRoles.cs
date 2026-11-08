namespace Planszowkarz.Data;

public static class AppRoles
{
    /// <summary>
    /// The main admin. Always held together with <see cref="Admin"/>, so every admin check covers it.
    /// Given only by the seeder (the configured Admin:UserName account); it can't be assigned in the app.
    /// Only the Owner may take the Admin role away from someone or delete an admin's account.
    /// </summary>
    public const string Owner = "Owner";
    public const string Admin = "Admin";
    public const string User = "User";

    /// <summary>Every role, for seeding.</summary>
    public static readonly string[] All = [Owner, Admin, User];

    /// <summary>Roles that can be chosen on the users page.</summary>
    public static readonly string[] Assignable = [Admin, User];
}
