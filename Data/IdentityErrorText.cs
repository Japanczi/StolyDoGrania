using Microsoft.AspNetCore.Identity;

namespace Planszowkarz.Data;

/// <summary>Polish text for the Identity errors a user can fix themselves; the rest keep Identity's description.</summary>
public static class IdentityErrorText
{
    public static string Describe(IdentityError error) => error.Code switch
    {
        nameof(IdentityErrorDescriber.DuplicateUserName) => "Ta nazwa użytkownika jest już zajęta.",
        nameof(IdentityErrorDescriber.DuplicateEmail) => "Ten adres e-mail jest już zarejestrowany.",
        nameof(IdentityErrorDescriber.InvalidUserName) => "Nazwa użytkownika zawiera niedozwolone znaki.",
        _ => error.Description,
    };
}
