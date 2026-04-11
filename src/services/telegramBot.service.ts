import mongoose from 'mongoose';
import { config } from '../config';
import { logger } from '../utils/logger';
import { removeTelegramKeyboard, sendTelegramKeyboard, sendTelegramMessage } from './telegram.service';
import * as authService from './auth.service';
import * as notificationService from './notification.service';

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    contact?: { phone_number?: string };
    from?: { username?: string };
    chat?: { id?: number | string };
  };
};

type BotState = {
  mode: 'idle' | 'await_register_name' | 'await_register_phone' | 'await_login_phone' | 'await_login_code';
  fullName?: string;
  phone?: string;
  username?: string;
  updatedAt: number;
};

let botStarted = false;
let updateOffset = 0;
const sessionByChatId = new Map<string, BotState>();
const lastActionAtByChatId = new Map<string, number>();
const SESSION_TTL_MS = 10 * 60 * 1000;
const MIN_ACTION_INTERVAL_MS = 700;

const MENU_LOGIN = 'Login';
const MENU_REGISTER = 'Register';
const MENU_MY_ID = 'My ID';
const MENU_HELP = 'Help';
const MENU_BACK = 'Back';

const MENU_OPEN_SITE = 'Open website';
const MENU_RECENT = 'Recent messages';
const MENU_PASSWORD = 'Site login & password';
const MENU_DISCONNECT = 'Disconnect Telegram';

function siteUrl(path: string): string {
  const base = config.telegram.frontendBaseUrl.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function normalizePhone(raw: string): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const hasPlus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  return `${hasPlus ? '+' : ''}${digits}`;
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

function isRateLimited(chatId: string): boolean {
  const now = Date.now();
  const prev = lastActionAtByChatId.get(chatId) ?? 0;
  if (now - prev < MIN_ACTION_INTERVAL_MS) return true;
  lastActionAtByChatId.set(chatId, now);
  return false;
}

async function showGuestMenu(chatId: string): Promise<void> {
  await sendTelegramKeyboard(chatId, 'You are not linked to an Edmission account. Connect your account:', [
    [{ text: MENU_LOGIN }, { text: MENU_REGISTER }],
    [{ text: MENU_MY_ID }, { text: MENU_HELP }],
  ]);
}

type LinkedUserLean = { name?: string; email?: string; role?: string; language?: string };

async function showLoggedInMenu(chatId: string, intro?: string): Promise<void> {
  const user = (await authService.findUserByTelegramChatId(chatId)) as LinkedUserLean | null;
  if (!user) {
    await showGuestMenu(chatId);
    return;
  }
  const name = String(user.name ?? '').trim() || 'there';
  const line =
    intro ??
    `You are signed in as ${name}. New notifications from the site will appear here. Use the buttons below.`;
  await sendTelegramKeyboard(chatId, line, [
    [{ text: MENU_OPEN_SITE }, { text: MENU_RECENT }],
    [{ text: MENU_PASSWORD }, { text: MENU_HELP }],
    [{ text: MENU_DISCONNECT }],
  ]);
}

async function tryLinkByPayload(chatId: string, payload: string, username?: string): Promise<boolean> {
  if (!payload) return false;
  if (!mongoose.Types.ObjectId.isValid(payload)) {
    await sendTelegramMessage(chatId, 'Invalid deep-link payload. Open the latest link from Edmission site.');
    return true;
  }
  await authService.linkTelegramToUser(payload, { chatId, username });
  await sendTelegramMessage(chatId, 'Telegram successfully linked to your Edmission account.');
  return true;
}

async function handleStart(chatId: string, payload: string, username?: string): Promise<void> {
  await tryLinkByPayload(chatId, payload, username);
  setSession(chatId, { mode: 'idle', fullName: undefined, phone: undefined, username });
  const user = (await authService.findUserByTelegramChatId(chatId)) as LinkedUserLean | null;
  if (user) {
    const name = String(user.name ?? '').trim() || 'there';
    await showLoggedInMenu(
      chatId,
      `Welcome back, ${name}. Your Telegram is linked to Edmission. You will receive site notifications here.`
    );
    return;
  }
  await sendTelegramMessage(chatId, 'Connect your Edmission account using the menu below.');
  await showGuestMenu(chatId);
}

async function handleHelp(chatId: string): Promise<void> {
  const registerUrl = siteUrl(config.telegram.registerPath);
  const loginUrl = siteUrl(config.telegram.loginPath);
  const linked = await authService.findUserByTelegramChatId(chatId);
  if (linked) {
    const email = String((linked as { email?: string }).email ?? '');
    await sendTelegramMessage(
      chatId,
      `Linked account help:\n- Open site: ${loginUrl}\n- Notifications on site: ${siteUrl(config.telegram.notificationsPath)}\n- Site login email: ${email || '—'}\n\nIf you registered only in Telegram, you have no password yet. Use "${MENU_PASSWORD}" in the menu, or Forgot password on the site with the email above.\n\n/start — refresh this menu.`
    );
    await showLoggedInMenu(chatId);
    return;
  }
  await sendTelegramMessage(
    chatId,
    `How it works:\n1) Login or Register.\n2) Website: ${loginUrl} / ${registerUrl}\n3) In this bot: share phone and follow steps.\n\n/start — main menu.`
  );
  await showGuestMenu(chatId);
}

async function handleLoginEntry(chatId: string): Promise<void> {
  setSession(chatId, { mode: 'await_login_phone', fullName: undefined, phone: undefined });
  await sendTelegramKeyboard(chatId, 'Choose login method:', [
    [{ text: 'Login via Website' }],
    [{ text: 'Login via Telegram Phone' }],
    [{ text: MENU_BACK }],
  ]);
}

async function handleRegisterEntry(chatId: string): Promise<void> {
  setSession(chatId, { mode: 'await_register_name', fullName: undefined, phone: undefined });
  await sendTelegramKeyboard(chatId, 'Choose registration method:', [
    [{ text: 'Register via Website' }],
    [{ text: 'Register via Telegram Phone' }],
    [{ text: MENU_BACK }],
  ]);
}

async function askForPhone(chatId: string, text: string): Promise<void> {
  await sendTelegramKeyboard(chatId, text, [
    [{ text: 'Share phone number', request_contact: true }],
    [{ text: MENU_BACK }],
  ]);
}

async function handlePhoneLogin(chatId: string, phone: string): Promise<void> {
  const issued = await authService.issueTelegramPhoneCode(phone);
  if (!issued) {
    await sendTelegramMessage(chatId, 'No account found for this phone. Use Register first.');
    await showGuestMenu(chatId);
    setSession(chatId, { mode: 'idle', phone: undefined });
    return;
  }
  setSession(chatId, { mode: 'await_login_code', phone });
  await removeTelegramKeyboard(chatId, `Login code: ${issued.code}\nEnter this 6-digit code here.`);
}

async function handlePhoneRegister(chatId: string, state: BotState, phone: string): Promise<void> {
  const fullName = String(state.fullName ?? '').trim();
  if (!fullName) {
    setSession(chatId, { mode: 'await_register_name' });
    await sendTelegramMessage(chatId, 'Please send your full name first.');
    return;
  }
  const result = await authService.registerFromTelegram({
    chatId,
    phone,
    fullName,
    username: state.username,
  });
  if (result.created) {
    await sendTelegramMessage(
      chatId,
      'Registration complete. Your account is linked. Use "Site login & password" to set up website access.'
    );
  } else {
    await sendTelegramMessage(chatId, 'This phone already had an account. Telegram is linked.');
  }
  setSession(chatId, { mode: 'idle', fullName: undefined, phone: undefined });
  await showLoggedInMenu(chatId);
}

async function handleTextMessage(chatId: string, text: string, username?: string): Promise<void> {
  if (isRateLimited(chatId)) return;
  const normalized = text.trim();
  if (!normalized) return;
  const state = getSession(chatId);
  setSession(chatId, { username: username ?? state.username });

  if (normalized.startsWith('/start')) {
    const payload = extractStartPayload(normalized);
    await handleStart(chatId, payload, username);
    return;
  }

  if (normalized === '/id' || normalized === MENU_MY_ID) {
    await sendTelegramMessage(chatId, `Your chat_id: ${chatId}`);
    const linked = await authService.findUserByTelegramChatId(chatId);
    if (linked) await showLoggedInMenu(chatId);
    else await showGuestMenu(chatId);
    return;
  }

  if (normalized === '/help' || normalized === MENU_HELP) {
    await handleHelp(chatId);
    return;
  }

  const linkedUser = await authService.findUserByTelegramChatId(chatId);

  if (linkedUser) {
    if (normalized === MENU_OPEN_SITE) {
      await sendTelegramMessage(chatId, `Open the site: ${siteUrl(config.telegram.loginPath)}`);
      await showLoggedInMenu(chatId);
      return;
    }
    if (normalized === MENU_RECENT) {
      const locale = ((linkedUser as { language?: string }).language === 'ru' ||
        (linkedUser as { language?: string }).language === 'uz'
        ? (linkedUser as { language?: string }).language
        : 'en') as 'en' | 'ru' | 'uz';
      const items = await notificationService.getRecentNotificationsForBot(String((linkedUser as { _id: unknown })._id), 5, locale);
      if (!items.length) {
        await sendTelegramMessage(chatId, 'No notifications yet. They will appear here when something happens on the site.');
      } else {
        const lines = items.map((n, i) => {
          const title = String(n.title ?? '').trim();
          const body = String(n.body ?? '').trim();
          return `${i + 1}. ${title}${body ? `\n   ${body}` : ''}`;
        });
        await sendTelegramMessage(chatId, `Recent messages:\n\n${lines.join('\n\n')}`);
      }
      await showLoggedInMenu(chatId);
      return;
    }
    if (normalized === MENU_PASSWORD) {
      const email = String((linkedUser as { email?: string }).email ?? '');
      const forgot = siteUrl(config.telegram.forgotPasswordPath);
      const login = siteUrl(config.telegram.loginPath);
      await sendTelegramMessage(
        chatId,
        `Website login\n\nEmail (use this on the login page):\n${email || '—'}\n\nPassword:\nIf you only registered in Telegram, you did not choose a password. Open the site → Login → Forgot password → enter the email above → follow the link in the email to set a password.\n\nLogin: ${login}\nForgot password: ${forgot}`
      );
      await showLoggedInMenu(chatId);
      return;
    }
    if (normalized === MENU_DISCONNECT) {
      await authService.unlinkTelegramByChatId(chatId);
      await sendTelegramMessage(chatId, 'Telegram disconnected from your Edmission account. You can link again anytime.');
      await showGuestMenu(chatId);
      return;
    }
  }

  if (normalized === MENU_BACK) {
    setSession(chatId, { mode: 'idle', fullName: undefined, phone: undefined });
    if (await authService.findUserByTelegramChatId(chatId)) await showLoggedInMenu(chatId);
    else await showGuestMenu(chatId);
    return;
  }

  if (normalized === MENU_LOGIN) {
    if (linkedUser) {
      await sendTelegramMessage(chatId, 'You are already linked. Use "Open website" or "Recent messages".');
      await showLoggedInMenu(chatId);
      return;
    }
    await handleLoginEntry(chatId);
    return;
  }

  if (normalized === MENU_REGISTER) {
    if (linkedUser) {
      await sendTelegramMessage(chatId, 'You are already linked. No need to register again.');
      await showLoggedInMenu(chatId);
      return;
    }
    await handleRegisterEntry(chatId);
    return;
  }

  if (normalized === 'Login via Website') {
    await sendTelegramMessage(chatId, `Open login page: ${siteUrl(config.telegram.loginPath)}`);
    if (await authService.findUserByTelegramChatId(chatId)) await showLoggedInMenu(chatId);
    else await showGuestMenu(chatId);
    return;
  }

  if (normalized === 'Register via Website') {
    await sendTelegramMessage(chatId, `Open registration page: ${siteUrl(config.telegram.registerPath)}`);
    if (await authService.findUserByTelegramChatId(chatId)) await showLoggedInMenu(chatId);
    else await showGuestMenu(chatId);
    return;
  }

  if (normalized === 'Login via Telegram Phone') {
    setSession(chatId, { mode: 'await_login_phone' });
    await askForPhone(chatId, 'Send your phone number to login.');
    return;
  }

  if (normalized === 'Register via Telegram Phone') {
    setSession(chatId, { mode: 'await_register_name' });
    await removeTelegramKeyboard(chatId, 'Send your full name (name and surname).');
    return;
  }

  if (state.mode === 'await_register_name') {
    if (normalized.length < 3) {
      await sendTelegramMessage(chatId, 'Please enter a valid full name.');
      return;
    }
    setSession(chatId, { mode: 'await_register_phone', fullName: normalized });
    await askForPhone(chatId, 'Now share your phone number for registration.');
    return;
  }

  if (state.mode === 'await_login_code') {
    const code = normalized.replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6 || !state.phone) {
      await sendTelegramMessage(chatId, 'Enter a 6-digit code.');
      return;
    }
    const user = await authService.verifyTelegramPhoneCode(state.phone, code);
    if (!user) {
      await sendTelegramMessage(chatId, 'No user found for this phone.');
      await showGuestMenu(chatId);
      return;
    }
    await authService.linkTelegramToUser(String(user._id), {
      chatId,
      phone: state.phone,
      username,
    });
    await sendTelegramMessage(chatId, 'Login successful. Telegram is linked to your account.');
    setSession(chatId, { mode: 'idle', phone: undefined, fullName: undefined });
    await showLoggedInMenu(chatId);
    return;
  }

  await sendTelegramMessage(chatId, 'Unknown command. Use the menu below.');
  if (await authService.findUserByTelegramChatId(chatId)) await showLoggedInMenu(chatId);
  else await showGuestMenu(chatId);
}

async function handleContactMessage(chatId: string, phoneRaw: string, username?: string): Promise<void> {
  if (isRateLimited(chatId)) return;
  const state = getSession(chatId);
  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    await sendTelegramMessage(chatId, 'Invalid phone number. Please try again.');
    return;
  }
  if (state.mode === 'await_login_phone') {
    await handlePhoneLogin(chatId, phone);
    return;
  }
  if (state.mode === 'await_register_phone') {
    await handlePhoneRegister(chatId, state, phone);
    return;
  }
  await sendTelegramMessage(chatId, 'Phone received. Use menu to continue.');
  setSession(chatId, { username });
}

async function pollUpdates(): Promise<void> {
  if (!botStarted) return;
  const token = config.telegram.botToken.trim();
  if (!token) return;

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
      const chatId = chatIdRaw != null ? String(chatIdRaw).trim() : '';
      if (!chatId) continue;
      try {
        if (typeof phone === 'string' && phone.trim()) {
          await handleContactMessage(chatId, phone, username);
          continue;
        }
        if (typeof text === 'string') {
          await handleTextMessage(chatId, text, username);
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
