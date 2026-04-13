import { TelegramMessageLink } from '../models';
import { config } from '../config';
import { AppError, ErrorCodes } from '../utils/errors';
import { logger } from '../utils/logger';
import { toPublicSiteUrl } from '../utils/publicSiteUrl';
import { sendTelegramKeyboard, sendTelegramMessage } from './telegram.service';
import * as authService from './auth.service';
import * as notificationService from './notification.service';

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    contact?: { phone_number?: string };
    from?: { username?: string };
    chat?: { id?: number | string };
    reply_to_message?: { message_id?: number };
  };
};

type BotState = {
  mode: 'idle' | 'await_login_email' | 'await_login_password';
  pendingEmail?: string;
  username?: string;
  updatedAt: number;
};

type LinkedUserLean = {
  _id?: unknown;
  name?: string;
  email?: string;
  role?: string;
  language?: string;
};

let botStarted = false;
let updateOffset = 0;
const sessionByChatId = new Map<string, BotState>();
const lastActionAtByChatId = new Map<string, number>();
const loginGuardByChatId = new Map<string, { failedCount: number; windowStartedAt: number; lockedUntil: number }>();
const SESSION_TTL_MS = 10 * 60 * 1000;
const MIN_ACTION_INTERVAL_MS = 700;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const MAX_TEXT_LENGTH = 2000;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
const LINK_CODE_REGEX = /^[a-f0-9]{32}$/i;
const REGISTRATION_CODE_REGEX = /^reg_[a-f0-9]{24}$/i;
let lastCleanupAt = 0;

const MENU_LOGIN = 'Login';
const MENU_REGISTER = 'Register';
const MENU_HELP = 'Help';
const MENU_BACK = 'Back';

const MENU_OPEN_SITE = 'Open website';
const MENU_RECENT = 'Recent messages';
const MENU_MARK_VIEWED = 'Mark as viewed';
const MENU_REPLY_HELP = 'How to reply';
const MENU_DISCONNECT = 'Disconnect Telegram';

function siteUrl(path: string): string {
  return toPublicSiteUrl(path);
}

function extractStartPayload(text: string): string {
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return '';
  return parts.slice(1).join(' ').trim();
}

function getSession(chatId: string): BotState {
  const now = Date.now();
  const existing = sessionByChatId.get(chatId);
  if (existing && now - existing.updatedAt <= SESSION_TTL_MS) {
    return existing;
  }
  const next: BotState = { mode: 'idle', updatedAt: now };
  sessionByChatId.set(chatId, next);
  return next;
}

function setSession(chatId: string, next: Partial<BotState>): BotState {
  const current = getSession(chatId);
  const merged: BotState = {
    ...current,
    ...next,
    updatedAt: Date.now(),
  };
  sessionByChatId.set(chatId, merged);
  return merged;
}

function resetSession(chatId: string): void {
  setSession(chatId, { mode: 'idle', pendingEmail: undefined });
}

function resetLoginGuard(chatId: string): void {
  loginGuardByChatId.delete(chatId);
}

function getLoginLockRemainingMs(chatId: string): number {
  const now = Date.now();
  const row = loginGuardByChatId.get(chatId);
  if (!row) return 0;
  return row.lockedUntil > now ? row.lockedUntil - now : 0;
}

function registerLoginFailure(chatId: string): { failedCount: number; lockedUntil: number } {
  const now = Date.now();
  const prev = loginGuardByChatId.get(chatId);
  const inWindow = prev && now - prev.windowStartedAt <= LOGIN_FAILURE_WINDOW_MS;
  const nextFailedCount = inWindow ? prev.failedCount + 1 : 1;
  const windowStartedAt = inWindow ? prev.windowStartedAt : now;
  const lockedUntil = nextFailedCount >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_LOCK_MS : 0;
  const next = { failedCount: nextFailedCount, windowStartedAt, lockedUntil };
  loginGuardByChatId.set(chatId, next);
  return { failedCount: next.failedCount, lockedUntil: next.lockedUntil };
}

function cleanupTransientState(force = false): void {
  const now = Date.now();
  if (!force && now - lastCleanupAt < 60_000) return;
  lastCleanupAt = now;

  for (const [chatId, state] of sessionByChatId.entries()) {
    if (now - state.updatedAt > SESSION_TTL_MS) {
      sessionByChatId.delete(chatId);
    }
  }

  for (const [chatId, ts] of lastActionAtByChatId.entries()) {
    if (now - ts > 10 * 60 * 1000) {
      lastActionAtByChatId.delete(chatId);
    }
  }

  for (const [chatId, guard] of loginGuardByChatId.entries()) {
    const lockExpired = guard.lockedUntil <= now;
    const windowExpired = now - guard.windowStartedAt > LOGIN_FAILURE_WINDOW_MS;
    if (lockExpired && windowExpired) {
      loginGuardByChatId.delete(chatId);
    }
  }
}

function isRateLimited(chatId: string): boolean {
  const now = Date.now();
  const prev = lastActionAtByChatId.get(chatId) ?? 0;
  if (now - prev < MIN_ACTION_INTERVAL_MS) return true;
  lastActionAtByChatId.set(chatId, now);
  return false;
}

function isEmailCandidate(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isVisibleReplyText(input: string): boolean {
  const v = input.trim();
  if (!v) return false;
  if (v.startsWith('/')) return false;
  const menuTexts = new Set([
    MENU_LOGIN,
    MENU_REGISTER,
    MENU_HELP,
    MENU_BACK,
    MENU_OPEN_SITE,
    MENU_RECENT,
    MENU_MARK_VIEWED,
    MENU_REPLY_HELP,
    MENU_DISCONNECT,
  ]);
  return !menuTexts.has(v);
}

async function showGuestMenu(chatId: string): Promise<void> {
  await sendTelegramKeyboard(chatId, 'Choose action:', [[{ text: MENU_REGISTER }, { text: MENU_LOGIN }]]);
}

async function showLoggedInMenu(chatId: string, intro?: string): Promise<void> {
  const user = (await authService.findUserByTelegramChatId(chatId)) as LinkedUserLean | null;
  if (!user) {
    await showGuestMenu(chatId);
    return;
  }
  const name = String(user.name ?? '').trim() || 'there';
  const line =
    intro ??
    `You are signed in as ${name}. New site messages will arrive here.`;
  await sendTelegramKeyboard(chatId, line, [
    [{ text: MENU_OPEN_SITE }, { text: MENU_RECENT }],
    [{ text: MENU_MARK_VIEWED }, { text: MENU_REPLY_HELP }],
    [{ text: MENU_DISCONNECT }, { text: MENU_HELP }],
  ]);
}

async function tryLinkByPayload(chatId: string, payload: string, username?: string): Promise<boolean> {
  const normalized = String(payload ?? '').trim();
  if (!normalized) return false;
  if (normalized.length > 80) {
    await sendTelegramMessage(chatId, 'Invalid link payload.');
    return false;
  }
  if (normalized.startsWith('reg_')) {
    if (!REGISTRATION_CODE_REGEX.test(normalized)) {
      await sendTelegramMessage(chatId, 'Invalid or expired registration code.');
      return false;
    }
    const result = await authService.verifyPhoneRegistrationByTelegram(normalized, chatId, username || '');
    await sendTelegramMessage(chatId, result.message);
    return false;
  }
  if (!LINK_CODE_REGEX.test(normalized)) {
    await sendTelegramMessage(chatId, 'Invalid link code. Open the latest Telegram link from the website.');
    return false;
  }
  const linked = await authService.linkTelegramByCode(normalized, { chatId, username });
  if (!linked) {
    await sendTelegramMessage(chatId, 'Invalid or expired link. Open the latest Telegram link from the website.');
    return false;
  }
  await sendTelegramMessage(chatId, 'Telegram successfully linked to your Edmission account.');
  return true;
}

async function handleStart(chatId: string, payload: string, username?: string): Promise<void> {
  await tryLinkByPayload(chatId, payload, username);
  setSession(chatId, { mode: 'idle', pendingEmail: undefined, username });
  const user = (await authService.findUserByTelegramChatId(chatId)) as LinkedUserLean | null;
  if (user) {
    const name = String(user.name ?? '').trim() || 'there';
    await showLoggedInMenu(chatId, `Welcome back, ${name}.`);
    return;
  }
  await sendTelegramMessage(chatId, 'Register on the website, then login in this bot using your email and password.');
  await showGuestMenu(chatId);
}

async function handleHelp(chatId: string): Promise<void> {
  const registerUrl = siteUrl(config.telegram.registerPath);
  const loginUrl = siteUrl(config.telegram.loginPath);
  const linked = await authService.findUserByTelegramChatId(chatId);
  if (linked) {
    const role = String((linked as { role?: string }).role ?? '');
    const openPath =
      role === 'student'
        ? '/student/chat'
        : role === 'university'
          ? '/university/chat'
          : config.telegram.notificationsPath;
    await sendTelegramMessage(
      chatId,
      [
        'Linked account help:',
        `- Website: ${siteUrl(openPath)}`,
        '- Reply to any incoming bot message to answer in the same site chat.',
        '- Use "Mark as viewed" to mark chats and notifications as read.',
        '',
        '/start - refresh menu',
      ].join('\n')
    );
    await showLoggedInMenu(chatId);
    return;
  }
  await sendTelegramMessage(
    chatId,
    [
      'How it works:',
      `1) Register on website: ${registerUrl}`,
      '2) In this bot tap Login',
      '3) Enter your website email and password',
      '4) Site messages will be delivered here',
      '',
      `Website login page: ${loginUrl}`,
      '/start - main menu',
    ].join('\n')
  );
  await showGuestMenu(chatId);
}

async function handleLoginEntry(chatId: string): Promise<void> {
  const lockRemainingMs = getLoginLockRemainingMs(chatId);
  if (lockRemainingMs > 0) {
    const waitMin = Math.ceil(lockRemainingMs / 60_000);
    await sendTelegramMessage(chatId, `Too many failed attempts. Try again in about ${waitMin} minute(s).`);
    return;
  }
  setSession(chatId, { mode: 'await_login_email', pendingEmail: undefined });
  await sendTelegramKeyboard(chatId, 'Enter your website email:', [[{ text: MENU_BACK }]]);
}

async function handleEmailInput(chatId: string, emailInput: string): Promise<void> {
  const lockRemainingMs = getLoginLockRemainingMs(chatId);
  if (lockRemainingMs > 0) {
    const waitMin = Math.ceil(lockRemainingMs / 60_000);
    await sendTelegramMessage(chatId, `Too many failed attempts. Try again in about ${waitMin} minute(s).`);
    return;
  }

  const email = emailInput.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH) {
    await sendTelegramMessage(chatId, 'Email is too long.');
    return;
  }
  if (!isEmailCandidate(email)) {
    await sendTelegramMessage(chatId, 'Please enter a valid email address.');
    return;
  }
  setSession(chatId, { mode: 'await_login_password', pendingEmail: email });
  await sendTelegramKeyboard(chatId, 'Now enter your website password:', [[{ text: MENU_BACK }]]);
}

function resolveLoginErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    if (
      error.code === ErrorCodes.UNAUTHORIZED ||
      error.code === ErrorCodes.FORBIDDEN ||
      error.code === ErrorCodes.VALIDATION
    ) {
      return 'Invalid email or password.';
    }
  }
  return 'Login failed. Please try again.';
}

async function handlePasswordInput(
  chatId: string,
  state: BotState,
  passwordInput: string,
  username?: string
): Promise<void> {
  const lockRemainingMs = getLoginLockRemainingMs(chatId);
  if (lockRemainingMs > 0) {
    const waitMin = Math.ceil(lockRemainingMs / 60_000);
    await sendTelegramMessage(chatId, `Too many failed attempts. Try again in about ${waitMin} minute(s).`);
    resetSession(chatId);
    await showGuestMenu(chatId);
    return;
  }

  const password = passwordInput.trim();
  const email = String(state.pendingEmail ?? '').trim().toLowerCase();
  if (!email) {
    await sendTelegramMessage(chatId, 'Login session expired. Tap Login again.');
    resetSession(chatId);
    await showGuestMenu(chatId);
    return;
  }
  if (!password) {
    await sendTelegramMessage(chatId, 'Password cannot be empty.');
    return;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    await sendTelegramMessage(chatId, 'Password is too long.');
    return;
  }

  try {
    const user = await authService.authenticateTelegramCredentials(email, password);
    await authService.linkTelegramToUser(user.id, { chatId, username });
    await sendTelegramMessage(chatId, `Login successful. Telegram linked to ${user.email}.`);
    resetLoginGuard(chatId);
    resetSession(chatId);
    await showLoggedInMenu(chatId);
  } catch (error) {
    const failure = registerLoginFailure(chatId);
    const lockWarning =
      failure.lockedUntil > Date.now()
        ? '\nToo many attempts. Login is temporarily locked for this chat.'
        : '';
    const message = resolveLoginErrorMessage(error);
    await sendTelegramMessage(
      chatId,
      `${message}${lockWarning}\nIf needed, reset password on website: ${siteUrl(config.telegram.forgotPasswordPath)}`
    );
    if (failure.lockedUntil > Date.now()) {
      resetSession(chatId);
    }
  }
}

async function handleReplyToChatMessage(
  appUserId: string,
  telegramChatId: string,
  replyToMessageId: number,
  text: string
): Promise<{ ok: boolean; message: string }> {
  const body = text.trim();
  if (!body) return { ok: false, message: 'Message cannot be empty.' };
  if (body.length > MAX_TEXT_LENGTH) {
    return { ok: false, message: `Message is too long. Maximum ${MAX_TEXT_LENGTH} characters.` };
  }

  const link = await TelegramMessageLink.findOne({
    telegramChatId,
    telegramMessageId: replyToMessageId,
    userId: appUserId,
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!link) {
    return {
      ok: false,
      message: 'Reply is not linked to a site chat. Reply directly to a new incoming message from this bot.',
    };
  }

  const chatService = await import('./chat.service');
  await chatService.saveMessage(String((link as { appChatId: unknown }).appChatId), appUserId, body);
  return { ok: true, message: 'Sent.' };
}

async function markAllAsViewed(appUserId: string): Promise<number> {
  const chatService = await import('./chat.service');
  const chats = await chatService.getChats(appUserId);
  let updated = 0;
  for (const row of chats as Array<{ id?: string }>) {
    const chatId = String(row.id ?? '').trim();
    if (!chatId) continue;
    await chatService.markRead(chatId, appUserId);
    updated += 1;
  }
  await notificationService.markAllRead(appUserId);
  return updated;
}

async function sendRecentItems(chatId: string, linkedUser: LinkedUserLean): Promise<void> {
  const locale = (
    linkedUser.language === 'ru' || linkedUser.language === 'uz' || linkedUser.language === 'en'
      ? linkedUser.language
      : 'en'
  ) as 'en' | 'ru' | 'uz';
  const items = await notificationService.getRecentNotificationsForBot(String(linkedUser._id), 5, locale);
  if (!items.length) {
    await sendTelegramMessage(chatId, 'No recent notifications.');
    return;
  }
  const lines = items.map((n, i) => {
    const title = String(n.title ?? '').trim();
    const body = String(n.body ?? '').trim();
    return `${i + 1}. ${title}${body ? `\n   ${body}` : ''}`;
  });
  await sendTelegramMessage(chatId, `Recent notifications:\n\n${lines.join('\n\n')}`);
}

async function handleTextMessage(
  chatId: string,
  text: string,
  username?: string,
  replyToMessageId?: number
): Promise<void> {
  if (isRateLimited(chatId)) return;
  const normalized = text.trim();
  if (!normalized) return;

  const state = getSession(chatId);
  if (state.mode !== 'await_login_password' && normalized.length > MAX_TEXT_LENGTH) {
    await sendTelegramMessage(chatId, `Message is too long. Maximum ${MAX_TEXT_LENGTH} characters.`);
    return;
  }

  setSession(chatId, { username: username ?? state.username });

  if (normalized.startsWith('/start')) {
    const payload = extractStartPayload(normalized);
    await handleStart(chatId, payload, username);
    return;
  }

  if (normalized === '/help' || normalized === MENU_HELP) {
    await handleHelp(chatId);
    return;
  }

  if (normalized === '/id') {
    await sendTelegramMessage(chatId, `Your chat_id: ${chatId}`);
    const linked = await authService.findUserByTelegramChatId(chatId);
    if (linked) await showLoggedInMenu(chatId);
    else await showGuestMenu(chatId);
    return;
  }

  const linkedUser = (await authService.findUserByTelegramChatId(chatId)) as LinkedUserLean | null;

  if (normalized === MENU_BACK) {
    resetSession(chatId);
    if (linkedUser) await showLoggedInMenu(chatId);
    else await showGuestMenu(chatId);
    return;
  }

  if (linkedUser) {
    if (normalized === MENU_OPEN_SITE) {
      const role = String(linkedUser.role ?? '');
      const openPath =
        role === 'student'
          ? '/student/chat'
          : role === 'university'
            ? '/university/chat'
            : config.telegram.notificationsPath;
      await sendTelegramMessage(chatId, `Open website: ${siteUrl(openPath)}`);
      await showLoggedInMenu(chatId);
      return;
    }

    if (normalized === MENU_RECENT) {
      await sendRecentItems(chatId, linkedUser);
      await showLoggedInMenu(chatId);
      return;
    }

    if (normalized === MENU_MARK_VIEWED || normalized === '/readall') {
      const count = await markAllAsViewed(String(linkedUser._id));
      await sendTelegramMessage(chatId, `Marked as viewed in ${count} chat(s).`);
      await showLoggedInMenu(chatId);
      return;
    }

    if (normalized === MENU_REPLY_HELP) {
      await sendTelegramMessage(
        chatId,
        'To reply, use Telegram Reply on an incoming message from this bot. Your answer will be sent to the same site chat.'
      );
      await showLoggedInMenu(chatId);
      return;
    }

    if (normalized === MENU_DISCONNECT) {
      await authService.unlinkTelegramByChatId(chatId);
      resetSession(chatId);
      await sendTelegramMessage(chatId, 'Telegram disconnected from your Edmission account.');
      await showGuestMenu(chatId);
      return;
    }

    if (normalized === MENU_LOGIN || normalized === MENU_REGISTER) {
      await sendTelegramMessage(chatId, 'You are already linked.');
      await showLoggedInMenu(chatId);
      return;
    }

    if (replyToMessageId && isVisibleReplyText(normalized)) {
      const result = await handleReplyToChatMessage(
        String(linkedUser._id),
        chatId,
        Number(replyToMessageId),
        normalized
      );
      await sendTelegramMessage(chatId, result.message);
      await showLoggedInMenu(chatId);
      return;
    }

    await sendTelegramMessage(chatId, 'Unknown command. Use menu buttons.');
    await showLoggedInMenu(chatId);
    return;
  }

  if (normalized === MENU_REGISTER) {
    resetSession(chatId);
    await sendTelegramMessage(
      chatId,
      `Register on website: ${siteUrl(config.telegram.registerPath)}\nAfter registration, tap Login here.`
    );
    await showGuestMenu(chatId);
    return;
  }

  if (normalized === MENU_LOGIN) {
    await handleLoginEntry(chatId);
    return;
  }

  if (state.mode === 'await_login_email') {
    await handleEmailInput(chatId, normalized);
    return;
  }

  if (state.mode === 'await_login_password') {
    await handlePasswordInput(chatId, state, normalized, username);
    return;
  }

  if (normalized === '/readall') {
    await sendTelegramMessage(chatId, 'Login first, then you can mark chats as viewed.');
    await showGuestMenu(chatId);
    return;
  }

  await sendTelegramMessage(chatId, 'Use Register or Login.');
  await showGuestMenu(chatId);
}

async function handleContactMessage(chatId: string): Promise<void> {
  if (isRateLimited(chatId)) return;
  resetSession(chatId);
  await sendTelegramMessage(
    chatId,
    `Phone login is disabled. Use Login and enter email + password.\nWebsite: ${siteUrl(config.telegram.loginPath)}`
  );
  const linked = await authService.findUserByTelegramChatId(chatId);
  if (linked) await showLoggedInMenu(chatId);
  else await showGuestMenu(chatId);
}

async function pollUpdates(): Promise<void> {
  if (!botStarted) return;
  const token = config.telegram.botToken.trim();
  if (!token) return;
  cleanupTransientState();

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeout: 25,
        offset: updateOffset,
        allowed_updates: ['message'],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.warn({ status: response.status, body }, 'Telegram getUpdates failed');
      setTimeout(() => void pollUpdates(), 1500);
      return;
    }

    const data = (await response.json()) as { ok?: boolean; result?: TelegramUpdate[]; description?: string };
    if (!data.ok) {
      logger.warn({ description: data.description }, 'Telegram getUpdates returned not ok');
      setTimeout(() => void pollUpdates(), 1500);
      return;
    }

    const updates = Array.isArray(data.result) ? data.result : [];
    for (const update of updates) {
      updateOffset = Math.max(updateOffset, Number(update.update_id) + 1);
      const chatIdRaw = update.message?.chat?.id;
      const text = update.message?.text;
      const phone = update.message?.contact?.phone_number;
      const username = update.message?.from?.username;
      const replyToMessageId = update.message?.reply_to_message?.message_id;
      const chatId = chatIdRaw != null ? String(chatIdRaw).trim() : '';
      if (!chatId) continue;
      try {
        if (typeof phone === 'string' && phone.trim()) {
          await handleContactMessage(chatId);
          continue;
        }
        if (typeof text === 'string') {
          await handleTextMessage(chatId, text, username, replyToMessageId);
        }
      } catch (e) {
        logger.warn(e, 'Telegram update handler failed');
      }
    }
  } catch (e) {
    logger.warn(e, 'Telegram polling error');
    setTimeout(() => void pollUpdates(), 1500);
    return;
  }

  setImmediate(() => void pollUpdates());
}

export function startTelegramBotPolling(): void {
  if (botStarted) return;
  const token = config.telegram.botToken.trim();
  if (!token) {
    logger.info('Telegram bot token is empty; polling disabled');
    return;
  }
  botStarted = true;
  logger.info('Telegram bot polling started');
  void pollUpdates();
}
