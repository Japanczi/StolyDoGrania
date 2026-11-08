namespace Planszowkarz.Components.Layout;

public static class UserNames
{
    /// <summary>Part of the user name before '@'; a full e-mail address is never displayed.</summary>
    public static string Short(string? name)
    {
        if (string.IsNullOrEmpty(name))
        {
            return string.Empty;
        }

        var at = name.IndexOf('@');
        return at > 0 ? name[..at] : name;
    }
}
