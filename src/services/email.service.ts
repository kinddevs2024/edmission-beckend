import nodemailer from 'nodemailer';
import { config } from '../config';
import { logger } from '../utils/logger';

const getFrontendUrl = () => config.frontendUrl?.replace(/\/$/, '') || 'https://edmission.uz';

export function buildResetPasswordLink(resetToken: string): string {
  const baseUrl = getFrontendUrl();
  return `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
}

function createSmtpTransporter() {
  const { host, port, user, pass } = config.email.smtp;
  if (!host || !user || !pass) return null;
  const passClean = String(pass).replace(/\s/g, ''); // Gmail app password often has spaces
  if (host === 'smtp.gmail.com') {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass: passClean },
    });
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: passClean },
  });
}

export async function sendMail(to: string, subject: string, html: string): Promise<boolean> {
  if (!config.email.enabled) {
    logger.info({ to, subject }, 'Email disabled (EMAIL_ENABLED!=true), would send');
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
        const text = await res.text();
        logger.warn({ status: res.status, body: text }, 'SendGrid error');
        return false;
      }
      return true;
    } catch (e) {
      logger.error(e, 'SendGrid send failed');
      return false;
    }
  }
  const transporter = createSmtpTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: `Edmission <${config.email.from}>`,
        to,
        subject,
        html,
      });
      return true;
    } catch (e: unknown) {
      const err = e as { code?: string; response?: string; responseCode?: number; command?: string; message?: string };
      logger.error(
        {
          code: err.code,
          responseCode: err.responseCode,
          response: typeof err.response === 'string' ? err.response.slice(0, 200) : err.response,
          command: err.command,
          message: err.message,
        },
        'SMTP send failed'
      );
      return false;
    }
  }
  logger.info({ to, subject }, 'No SendGrid or SMTP configured, email not sent');
  return false;
}

export function applicationStatusChangedHtml(universityName: string, status: string, studentName: string): string {
  return `
    <p>Hello ${studentName},</p>
    <p>Your application status at <strong>${universityName}</strong> has been updated to: <strong>${status.replace(/_/g, ' ')}</strong>.</p>
    <p>Login to Edmission to view details.</p>
    <p>— Edmission Team</p>
  `;
}

export function resetPasswordHtml(resetLink: string): string {
  return `
    <p>You requested a password reset.</p>
    <p><a href="${resetLink}">Reset your password</a></p>
    <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
    <p>— Edmission Team</p>
  `;
}

export async function sendResetPasswordEmail(to: string, resetToken: string): Promise<boolean> {
  const resetLink = buildResetPasswordLink(resetToken);
  return sendMail(to, 'Reset your password', resetPasswordHtml(resetLink));
}

export function inviteSetPasswordHtml(setPasswordLink: string): string {
  return `
    <p>You have been invited to Edmission.</p>
    <p><a href="${setPasswordLink}">Set your password</a> to sign in.</p>
    <p>This link expires in 7 days. If you didn't expect this invitation, you can ignore this email.</p>
    <p>— Edmission Team</p>
  `;
}

export async function sendInviteSetPasswordEmail(to: string, resetToken: string): Promise<boolean> {
  const baseUrl = getFrontendUrl();
  const setPasswordLink = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;
  return sendMail(to, 'Set your Edmission password', inviteSetPasswordHtml(setPasswordLink));
}

export function verificationCodeHtml(code: string): string {
  return `
    <p>Your Edmission verification code is:</p>
    <p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${code}</p>
    <p>Enter this code on the registration page to verify your email. The code expires in 15 minutes.</p>
    <p>If you didn't create an account, you can ignore this email.</p>
    <p>— Edmission Team</p>
  `;
}

export async function sendVerificationCodeEmail(to: string, code: string): Promise<boolean> {
  return sendMail(to, 'Verify your email – Edmission', verificationCodeHtml(code));
}

export function newMessageHtml(messagePreview: string, chatLink: string): string {
  const preview = messagePreview ? messagePreview.slice(0, 200) : 'New message';
  return `
    <p>You have received a new message on Edmission.</p>
    <p style="margin:16px 0;padding:12px;background:#f1f5f9;border-radius:8px;font-style:italic;">${preview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
    <p><a href="${chatLink}" style="display:inline-block;padding:10px 20px;background:#84cc16;color:#0f172a;text-decoration:none;border-radius:8px;font-weight:600;">Open chat</a></p>
    <p>— Edmission Team</p>
  `;
}

export async function sendNewMessageEmail(to: string, messagePreview: string, recipientRole?: string): Promise<boolean> {
  const baseUrl = getFrontendUrl();
  const path = recipientRole === 'university' ? '/university/chat' : recipientRole === 'admin' ? '/admin/chats' : '/student/chat';
  const chatLink = `${baseUrl}${path}`;
  return sendMail(to, 'New message – Edmission', newMessageHtml(messagePreview, chatLink));
}

export function trialReminderHtml(daysLeft: number, planName: string): string {
  return `
    <p>Your trial ends in ${daysLeft} day(s).</p>
    <p>Upgrade to <strong>${planName}</strong> to keep sending applications and access all features.</p>
    <p><a href="${process.env.FRONTEND_URL || 'https://edmission.uz'}/payment">Upgrade now</a></p>
    <p>— Edmission Team</p>
  `;
}
