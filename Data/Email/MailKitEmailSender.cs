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

    private const string Closing = "Miłej zabawy!";

    /// <summary>
    /// Identity uses this both for new accounts and for changing the address in the profile;
    /// the latter links to Account/ConfirmEmailChange, which is how the two texts are told apart
    /// without editing the scaffolded Identity pages.
    /// </summary>
    public Task SendConfirmationLinkAsync(ApplicationUser user, string email, string confirmationLink) =>
        IsEmailChangeLink(confirmationLink)
            ? SendLinkAsync(email, "Potwierdź nowy adres e-mail",
                "Hej, potwierdź nowy adres e-mail dla swojego konta na Planszówkarzu.", confirmationLink)
            : SendLinkAsync(email, "Potwierdź adres e-mail",
                "Hej, dzięki za założenie konta na Planszówkarzu :)", confirmationLink);

    private static bool IsEmailChangeLink(string encodedLink) =>
        Uri.TryCreate(WebUtility.HtmlDecode(encodedLink), UriKind.Absolute, out var uri)
        && uri.AbsolutePath.EndsWith("/Account/ConfirmEmailChange", StringComparison.OrdinalIgnoreCase);

    public Task SendPasswordResetLinkAsync(ApplicationUser user, string email, string resetLink) =>
        SendLinkAsync(email, "Resetowanie hasła",
            "Hej, dostaliśmy prośbę o zresetowanie hasła do Twojego konta na Planszówkarzu.", resetLink);

    public Task SendPasswordResetCodeAsync(ApplicationUser user, string email, string resetCode) =>
        SendAsync(email, "Resetowanie hasła",
            $"<p>Hej, dostaliśmy prośbę o zresetowanie hasła do Twojego konta na Planszówkarzu.<br>" +
            $"Twój kod: <strong>{WebUtility.HtmlEncode(resetCode)}</strong></p><p>{Closing}</p>",
            $"Hej, dostaliśmy prośbę o zresetowanie hasła do Twojego konta na Planszówkarzu.\n" +
            $"Twój kod: {resetCode}\n\n{Closing}");

    /// <summary>
    /// Greeting, a clickable "Tutaj" plus the full link written out, then the closing line.
    /// The link arrives already HTML-encoded by the Identity pages, so it goes into the HTML body
    /// as-is and is decoded for the plain-text body.
    /// </summary>
    private Task SendLinkAsync(string to, string subject, string greeting, string encodedLink) =>
        SendAsync(to, subject,
            $"<p>{greeting}<br>" +
            $"Kliknij <a href=\"{encodedLink}\">Tutaj</a> albo wejdź pod ten link: <a href=\"{encodedLink}\">{encodedLink}</a></p>" +
            $"<p>{Closing}</p>",
            $"{greeting}\nWejdź pod ten link: {WebUtility.HtmlDecode(encodedLink)}\n\n{Closing}");

    private async Task SendAsync(string to, string subject, string htmlBody, string textBody)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(settings.FromName, settings.FromAddress));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = $"{subject} – Planszówkarz";
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
