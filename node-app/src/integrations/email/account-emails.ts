// The account e-mails, in Polish, with the layout from Resources.txt: greeting, then
// "Kliknij Tutaj (link) albo wejdź pod ten link: (full link)", then "Miłej zabawy!".
// Texts unchanged from Data/Email/MailKitEmailSender.cs.

import { html } from '../../web/html.ts';
import type { EmailMessage } from './mailer.ts';

const closing = 'Miłej zabawy!';

export function confirmAccountEmail(to: string, link: string): EmailMessage {
  return linkEmail(to, 'Potwierdź adres e-mail', 'Hej, dzięki za założenie konta na Planszówkarzu :)', link);
}

export function confirmEmailChangeEmail(to: string, link: string): EmailMessage {
  return linkEmail(to, 'Potwierdź nowy adres e-mail', 'Hej, potwierdź nowy adres e-mail dla swojego konta na Planszówkarzu.', link);
}

export function resetPasswordEmail(to: string, link: string): EmailMessage {
  return linkEmail(to, 'Resetowanie hasła', 'Hej, dostaliśmy prośbę o zresetowanie hasła do Twojego konta na Planszówkarzu.', link);
}

function linkEmail(to: string, subject: string, greeting: string, link: string): EmailMessage {
  return {
    to,
    subject,
    // The html tag escapes the link (e.g. "&" in the query string becomes "&amp;"), as HTML requires.
    html: html`<p>${greeting}<br>Kliknij <a href="${link}">Tutaj</a> albo wejdź pod ten link: <a href="${link}">${link}</a></p><p>${closing}</p>`.value,
    text: `${greeting}\nWejdź pod ten link: ${link}\n\n${closing}`,
  };
}
