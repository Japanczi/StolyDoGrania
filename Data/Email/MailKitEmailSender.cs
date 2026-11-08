using System.Net;
using MailKit.Net.Smtp;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;
using MimeKit;

namespace StolyDoGrania.Data.Email;

/// <summary>
/// Sends Identity e-mails (account confirmation, password reset) over SMTP with MailKit.
/// Failures are logged and not rethrown: the Identity pages have already done their work
/// (e.g. created the account), and the user can request the e-mail again.
/// </summary>
public sealed class MailKitEmailSender(IOptions<EmailSettings> options, ILogger<MailKitEmailSender> logger)
    : IEmailSender<ApplicationUser>
{
    private readonly EmailSettings settings = options.Value;

    // Links arrive already HTML-encoded by the Identity pages, so they go into the HTML body as-is
    // and are decoded for the plain-text body.
    public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink) =>
        SendAsync(email,
            "Potwierdź adres e-mail",
            $"<p>Cześć!</p><p>Aby potwierdzić adres e-mail w StolyDoGrania, <a href=\"{confirmationLink}\">kliknij tutaj</a>.</p>" +
            "<p>Jeśli nie spodziewasz się tej wiadomości, po prostu ją zignoruj.</p>",
            $"Cześć!\n\nAby potwierdzić adres e-mail w StolyDoGrania, otwórz ten link:\n{WebUtility.HtmlDecode(confirmationLink)}\n\n" +
            "Jeśli nie spodziewasz się tej wiadomości, po prostu ją zignoruj.");

    public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink) =>
        SendAsync(email,
            "Resetowanie hasła",
            $"<p>Cześć!</p><p>Aby ustawić nowe hasło w StolyDoGrania, <a href=\"{resetLink}\">kliknij tutaj</a>.</p>" +
            "<p>Jeśli nie prosisz o zmianę hasła, po prostu zignoruj tę wiadomość.</p>",
            $"Cześć!\n\nAby ustawić nowe hasło w StolyDoGrania, otwórz ten link:\n{WebUtility.HtmlDecode(resetLink)}\n\n" +
            "Jeśli nie prosisz o zmianę hasła, po prostu zignoruj tę wiadomość.");

    public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode) =>
        SendAsync(email,
            "Resetowanie hasła",
            $"<p>Cześć!</p><p>Kod do zresetowania hasła w StolyDoGrania: <strong>{WebUtility.HtmlEncode(resetCode)}</strong></p>",
            $"Cześć!\n\nKod do zresetowania hasła w StolyDoGrania: {resetCode}");

    private async Task SendAsync(string to, string subject, string htmlBody, string textBody)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(settings.FromName, settings.FromAddress));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = $"{subject} – StolyDoGrania";
        message.Body = new BodyBuilder { HtmlBody = htmlBody, TextBody = textBody }.ToMessageBody();

        try
        {
            using var client = new SmtpClient();
            await client.ConnectAsync(settings.Host, settings.Port, settings.Security);
            if (!string.IsNullOrEmpty(settings.UserName))
            {
                await client.AuthenticateAsync(settings.UserName, settings.Password);
            }
            await client.SendAsync(message);
            await client.DisconnectAsync(quit: true);
        }
        catch (Exception ex)
        {
            // Don't log the recipient address in full (privacy rule); the domain is enough for diagnosis.
            logger.LogError(ex, "Sending e-mail \"{Subject}\" to *@{Domain} failed.", subject, to.Split('@').LastOrDefault());
        }
    }
}
