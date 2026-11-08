using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;

namespace Planszowkarz.Data;

/// <summary>
/// Checks a user name as it will be stored: trimmed, with runs of spaces collapsed to one,
/// 3–20 characters of letters (incl. Polish), digits, spaces, '.', '_' or '-'.
/// No '@' allowed, so a user name can never be mistaken for an e-mail address at login.
/// </summary>
public sealed class ValidUserNameAttribute() : ValidationAttribute(
    "Nazwa użytkownika: 3–20 znaków – litery, cyfry, spacje, „.”, „_” lub „-”.")
{
    private static readonly Regex Allowed = new(@"^[a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ_.\- ]{3,20}$");

    /// <summary>Trims and collapses runs of spaces, so "Jan  Nowak" and "Jan Nowak" can't both exist.</summary>
    public static string Normalize(string value) =>
        string.Join(' ', value.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));

    public override bool IsValid(object? value) =>
        value is not string s || Allowed.IsMatch(Normalize(s));
}
