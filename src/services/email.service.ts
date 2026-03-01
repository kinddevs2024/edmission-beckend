import { config } from '../config';
import { logger } from '../utils/logger';

export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!config.email.enabled) {
    logger.info({ to, subject }, 'Email disabled, would send');
    return true;
  }
  if (config.email.sendgridApiKey) {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.email.sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: config.email.from, name: 'Edmission' },
          subject,
          content: [{ type: 'text/html', value: html }],
        }),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, 'SendGrid error');
        return false;
      }
      return true;
    } catch (e) {
      logger.error(e, 'SendGrid send failed');
      return false;
    }
  }
  logger.info({ to, subject }, 'No SendGrid key, email not sent');
  return false;
}

export function applicationStatusChangedHtml(universityName: string, status: string, studentName: string): string {
  return `
    <p>Hello ${studentName},</p>
    <p>Your application status at <strong>${universityName}</strong> has been updated to: <strong>${status.replace(/_/g, ' ')}</strong>.</p>
    <p>Log in to Edmission to view details.</p>
    <p>— Edmission Team</p>
  `;
}

export function trialReminderHtml(daysLeft: number, planName: string): string {
  return `
    <p>Your trial ends in ${daysLeft} day(s).</p>
    <p>Upgrade to <strong>${planName}</strong> to keep sending applications and access all features.</p>
    <p><a href="${process.env.FRONTEND_URL || 'https://edmission.uz'}/payment">Upgrade now</a></p>
    <p>— Edmission Team</p>
  `;
}
