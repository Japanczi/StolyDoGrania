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

    /// <summary>The highest of a user's roles: Owner, then Admin, otherwise User.</summary>
    public static string MainRole(IEnumerable<string> roles) =>
        roles.Contains(Owner) ? Owner
        : roles.Contains(Admin) ? Admin
        : User;

    /// <summary>
    /// Whether an admin may change the role of, or delete, a user whose main role is <paramref name="targetRole"/>:
    /// nobody touches the Owner, and only the Owner touches other admins.
    /// </summary>
    public static bool CanManage(string targetRole, bool actorIsOwner) =>
        targetRole switch
        {
            Owner => false,
            Admin => actorIsOwner,
            _ => true
        };
}
