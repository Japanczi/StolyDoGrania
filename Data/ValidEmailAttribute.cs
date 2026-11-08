using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;

namespace Planszowkarz.Data;

/// <summary>
/// Stricter than [EmailAddress], which only checks for a single '@' (so "a@b" passes).
/// Requires a local part of letters, digits and . _ % + - (no leading, trailing or double dots),
/// and a domain made of valid labels ending in a top-level domain of at least two letters,
/// e.g. "jan.nowak@example.com". Max 254 characters. Null and empty pass; use [Required] for those.
/// </summary>
public sealed partial class ValidEmailAttribute() : ValidationAttribute(
    "Podaj poprawny adres e-mail, np. jan.nowak@example.com.")
{
    [GeneratedRegex(@"^(?!\.)(?!.*\.\.)[A-Za-z0-9._%+\-]+(?<!\.)@(?:[A-Za-z0-9](?:[A-Za-z0-9\-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$")]
    private static partial Regex Pattern();

    public override bool IsValid(object? value) =>
        value is not string s || s.Length == 0 || (s.Length <= 254 && Pattern().IsMatch(s));
}
