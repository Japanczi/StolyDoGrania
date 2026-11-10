// Sending e-mail over SMTP with nodemailer. Port of Data/Email/MailKitEmailSender.cs (MailKit ≈ nodemailer).

import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { EmailConfig } from '../../config.ts';

export type EmailMessage = {
  to: string;
  /** Without the " – Planszówkarz" ending; the mailer adds it. */
  subject: string;
  html: string;
  text: string;
};

/** Anything that can send an e-mail. Tests use a fake that only records messages. */
export type Mailer = {
  /** False for the no-op mailer: pages then show the confirm link instead (as the .NET no-op sender did). */
  readonly sendsEmail: boolean;
  /** Never throws: a failure is logged, because the page has already done its work (e.g. created the account). */
  send(message: EmailMessage): Promise<void>;
};

/**
 * Used when EMAIL_HOST isn't set: nothing is sent. In development the message text (with its link) goes to the
 * log instead, so password reset and e-mail change can be tried locally. Never in production: links are secrets.
 */
export function createNoOpMailer(log: FastifyBaseLogger, logMessages: boolean): Mailer {
  return {
    sendsEmail: false,
    send: async message => {
      if (logMessages) {
        log.info(`E-mail not sent (EMAIL_HOST not set): "${message.subject}"\n${message.text}`);
      }
    },
  };
}

export function createSmtpMailer(settings: EmailConfig, log: FastifyBaseLogger): Mailer {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // "secure" means TLS from the first byte (port 465); otherwise STARTTLS upgrades the connection,
    // and requireTLS refuses to send unencrypted if the server doesn't offer it.
    secure: settings.security === 'ssl',
    requireTLS: settings.security === 'starttls',
    ignoreTLS: settings.security === 'none',
    ...(settings.user !== '' ? { auth: { user: settings.user, pass: settings.password } } : {}),
  });

  return {
    sendsEmail: true,
    async send(message) {
      try {
        await transport.sendMail({
          from: { name: settings.fromName, address: settings.fromAddress },
          to: message.to,
          subject: `${message.subject} – Planszówkarz`,
          html: message.html,
          text: message.text,
        });
      } catch (err) {
        // Don't log the recipient's full address (privacy rule); the domain is enough for diagnosis.
        log.error({ err, domain: message.to.split('@').pop() }, `Sending e-mail "${message.subject}" failed`);
      }
    },
  };
}
