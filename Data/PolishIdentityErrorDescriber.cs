using Microsoft.AspNetCore.Identity;

namespace Planszowkarz.Data;

/// <summary>
/// Polish texts for every Identity error (registration, password change/reset, admin role edits).
/// Codes stay the same as the default describer's, so code that checks <see cref="IdentityError.Code"/> keeps working.
/// </summary>
public sealed class PolishIdentityErrorDescriber : IdentityErrorDescriber
{
    private static IdentityError Error(string code, string description) => new() { Code = code, Description = description };

    public override IdentityError DefaultError() => Error(nameof(DefaultError), "Wystąpił nieznany błąd.");
    public override IdentityError ConcurrencyFailure() => Error(nameof(ConcurrencyFailure), "Dane zostały w międzyczasie zmienione. Odśwież stronę i spróbuj ponownie.");
    public override IdentityError PasswordMismatch() => Error(nameof(PasswordMismatch), "Nieprawidłowe hasło.");
    public override IdentityError InvalidToken() => Error(nameof(InvalidToken), "Link lub kod jest nieprawidłowy albo wygasł.");
    public override IdentityError RecoveryCodeRedemptionFailed() => Error(nameof(RecoveryCodeRedemptionFailed), "Nieprawidłowy kod odzyskiwania.");
    public override IdentityError LoginAlreadyAssociated() => Error(nameof(LoginAlreadyAssociated), "To zewnętrzne logowanie jest już powiązane z innym kontem.");
    public override IdentityError InvalidUserName(string? userName) => Error(nameof(InvalidUserName), "Nazwa użytkownika zawiera niedozwolone znaki.");
    public override IdentityError InvalidEmail(string? email) => Error(nameof(InvalidEmail), "Nieprawidłowy adres e-mail.");
    public override IdentityError DuplicateUserName(string userName) => Error(nameof(DuplicateUserName), "Ta nazwa użytkownika jest już zajęta.");
    public override IdentityError DuplicateEmail(string email) => Error(nameof(DuplicateEmail), "Ten adres e-mail jest już zarejestrowany.");
    public override IdentityError InvalidRoleName(string? role) => Error(nameof(InvalidRoleName), $"Nieprawidłowa nazwa roli „{role}”.");
    public override IdentityError DuplicateRoleName(string role) => Error(nameof(DuplicateRoleName), $"Rola „{role}” już istnieje.");
    public override IdentityError UserAlreadyHasPassword() => Error(nameof(UserAlreadyHasPassword), "To konto ma już ustawione hasło.");
    public override IdentityError UserLockoutNotEnabled() => Error(nameof(UserLockoutNotEnabled), "Blokada nie jest włączona dla tego konta.");
    public override IdentityError UserAlreadyInRole(string role) => Error(nameof(UserAlreadyInRole), $"Użytkownik ma już rolę „{role}”.");
    public override IdentityError UserNotInRole(string role) => Error(nameof(UserNotInRole), $"Użytkownik nie ma roli „{role}”.");
    public override IdentityError PasswordTooShort(int length) => Error(nameof(PasswordTooShort), $"Hasło musi mieć co najmniej {length} znaków.");
    public override IdentityError PasswordRequiresUniqueChars(int uniqueChars) => Error(nameof(PasswordRequiresUniqueChars), $"Hasło musi zawierać co najmniej {uniqueChars} różnych znaków.");
    public override IdentityError PasswordRequiresNonAlphanumeric() => Error(nameof(PasswordRequiresNonAlphanumeric), "Hasło musi zawierać co najmniej jeden znak specjalny.");
    public override IdentityError PasswordRequiresDigit() => Error(nameof(PasswordRequiresDigit), "Hasło musi zawierać co najmniej jedną cyfrę ('0'–'9').");
    public override IdentityError PasswordRequiresLower() => Error(nameof(PasswordRequiresLower), "Hasło musi zawierać co najmniej jedną małą literę ('a'–'z').");
    public override IdentityError PasswordRequiresUpper() => Error(nameof(PasswordRequiresUpper), "Hasło musi zawierać co najmniej jedną wielką literę ('A'–'Z').");
}
