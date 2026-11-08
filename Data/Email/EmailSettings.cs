using MailKit.Security;

namespace StolyDoGrania.Data.Email;

/// <summary>
/// SMTP settings for outgoing e-mail, read from the "Email" configuration section.
/// Keep UserName and Password in user-secrets or environment variables, never in appsettings.json.
/// </summary>
public sealed class EmailSettings
{
    public const string SectionName = "Email";

    /// <summary>SMTP server, e.g. smtp.gmail.com. When empty, no e-mail is sent (no-op sender is used).</summary>
    public string Host { get; set; } = "";

    /// <summary>587 for STARTTLS (default), 465 for SSL on connect, 25 or other for a local test server.</summary>
    public int Port { get; set; } = 587;

    /// <summary>Connection encryption: StartTls (default), SslOnConnect, Auto or None (local test servers only).</summary>
    public SecureSocketOptions Security { get; set; } = SecureSocketOptions.StartTls;

    /// <summary>SMTP login. When empty, the sender doesn't authenticate (local test servers).</summary>
    public string UserName { get; set; } = "";

    /// <summary>SMTP password; for Gmail an app password, not the account password.</summary>
    public string Password { get; set; } = "";

    /// <summary>Sender address shown to recipients. For Gmail it must be the account's own address.</summary>
    public string FromAddress { get; set; } = "";

    /// <summary>Sender name shown to recipients.</summary>
    public string FromName { get; set; } = "StolyDoGrania";
}
