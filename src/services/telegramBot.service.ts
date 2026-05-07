import { TelegramMessageLink } from '../models';
import { config } from '../config';
import { AppError, ErrorCodes } from '../utils/errors';
import { logger } from '../utils/logger';
import { toPublicSiteUrl } from '../utils/publicSiteUrl';
import { removeTelegramKeyboard, sendTelegramKeyboard, sendTelegramMessage } from './telegram.service';
import * as authService from './auth.service';
import * as notificationService from './notification.service';

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    contact?: { phone_number?: string; user_id?: number };
    from?: { id?: number; username?: string; first_name?: string; last_name?: string };
    chat?: { id?: number | string };
    reply_to_message?: { message_id?: number };
  };
};

type BotState = {
  lang?: 'uz' | 'ru' | 'en';
  mode:
    | 'idle'
    | 'await_login_email'
    | 'await_login_password'
    | 'await_phone_registration_contact'
    | 'await_telegram_auth_contact'
    | 'await_telegram_auth_name'
    | 'await_telegram_auth_email';
  pendingEmail?: string;
  pendingLoginVerifiedContact?: boolean;
  pendingPhoneRegistrationCode?: string;
  telegramAuthSessionId?: string;
  telegramAuthPhone?: string;
  telegramAuthFirstName?: string;
  telegramAuthLastName?: string;
  pendingStartPayload?: string;
  pendingStartUsername?: string;
  pendingStartFirstName?: string;
  pendingStartLastName?: string;
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
const MIN_ACTION_INTERVAL_MS = 150;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const MAX_TEXT_LENGTH = 2000;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
const LINK_CODE_REGEX = /^[a-f0-9]{32}$/i;
const REGISTRATION_CODE_REGEX = /^reg_[a-f0-9]{24}$/i;
const TELEGRAM_WEB_AUTH_START_PREFIX = 'LOGIN_';
const TELEGRAM_WEB_AUTH_SESSION_ID_REGEX = /^[a-f0-9]{32}$/i;
const PHONE_INPUT_REGEX = /^\+?[0-9()\-\s]{7,20}$/;
let lastCleanupAt = 0;

const MENU_LOGIN = 'Login';
const MENU_REGISTER = 'Register';
const MENU_HELP = 'Help';
const MENU_BACK = 'Back';
const MENU_SKIP_EMAIL = 'Skip email';
const MENU_FORGOT_PASSWORD = 'Forgot password';

const MENU_OPEN_SITE = 'Open app';
const MENU_RECENT = 'Recent messages';
const MENU_MARK_VIEWED = 'Mark as viewed';
const MENU_REPLY_HELP = 'How to reply';
const MENU_DISCONNECT = 'Disconnect Telegram';

type BotLang = 'uz' | 'ru' | 'en';

const I18N: Record<BotLang, Record<string, string>> = {
  en: {
    chooseLanguage: 'Choose language:',
    languageSaved: 'Language saved.',
    chooseAction: 'Do you have an account?',
    haveAccount: 'I have account',
    noAccount: 'No account',
    back: 'Back',
    sharePhonePrompt: 'Share your phone number to continue registration.',
    sharePhoneButton: 'Share phone number',
    askNamePrompt: 'Phone received. Now send your name.',
    askEmailPrompt: 'Optional: send your email, or tap Skip email.',
    skipEmail: 'Skip email',
    doneOpenWebsite: 'Done. Open website to continue:',
    sessionExpiredRestart: 'Session expired. Starting a new registration flow.',
    invalidSessionRestart: 'Invalid login session. Starting a new registration flow.',
    openWebsite: 'Open Website',
  },
  ru: {
    chooseLanguage: 'Выберите язык:',
    languageSaved: 'Язык сохранен.',
    chooseAction: 'У вас уже есть аккаунт?',
    haveAccount: 'Есть аккаунт',
    noAccount: 'Нет аккаунта',
    back: 'Назад',
    sharePhonePrompt: 'Отправьте номер телефона для продолжения регистрации.',
    sharePhoneButton: 'Отправить номер телефона',
    askNamePrompt: 'Номер получен. Теперь отправьте ваше имя.',
    doneOpenWebsite: 'Готово. Откройте сайт, чтобы продолжить:',
    sessionExpiredRestart: 'Сессия истекла. Запускаю новую регистрацию.',
    invalidSessionRestart: 'Неверная сессия входа. Запускаю новую регистрацию.',
    openWebsite: 'Открыть сайт',
  },
  uz: {
    chooseLanguage: 'Tilni tanlang:',
    languageSaved: 'Til saqlandi.',
    chooseAction: 'Sizda akkaunt bormi?',
    haveAccount: 'Akkauntim bor',
    noAccount: "Akkauntim yo'q",
    back: 'Orqaga',
    sharePhonePrompt: "Ro'yxatdan o'tishni davom ettirish uchun telefon raqamingizni yuboring.",
    sharePhoneButton: 'Telefon raqamni yuborish',
    askNamePrompt: 'Telefon olindi. Endi ismingizni yuboring.',
    doneOpenWebsite: 'Tayyor. Davom etish uchun saytni oching:',
    sessionExpiredRestart: "Sessiya tugadi. Yangi ro'yxatdan o'tishni boshlayman.",
    invalidSessionRestart: "Noto'g'ri kirish sessiyasi. Yangi ro'yxatdan o'tishni boshlayman.",
    openWebsite: 'Saytni ochish',
  },
};

const LANGUAGE_CHOICES: Array<{ key: BotLang; labels: string[] }> = [
  { key: 'uz', labels: ['uz', "o'zbek", 'uzbek', 'узбек', 'uzb'] },
  { key: 'ru', labels: ['ru', 'русский', 'russian', 'rus'] },
  { key: 'en', labels: ['en', 'english', 'английский', 'ingliz'] },
];

const I18N_OVERRIDE: Partial<Record<BotLang, Partial<Record<keyof (typeof I18N)['en'], string>>>> = {
  en: {
    askNamePrompt: 'Please send your name to start registration.',
    sharePhonePrompt: 'Now share your phone number to finish registration.',
    doneOpenWebsite: 'Registration is ready. Open Edmission:',
    openWebsite: 'Open Edmission',
  },
  ru: {
    languageSaved: 'Язык сохранён.',
    askNamePrompt: 'Отправьте ваше имя, чтобы начать регистрацию.',
    sharePhonePrompt: 'Теперь отправьте номер телефона, чтобы завершить регистрацию.',
    sharePhoneButton: 'Отправить номер телефона',
    doneOpenWebsite: 'Регистрация готова. Откройте Edmission:',
    openWebsite: 'Открыть Edmission',
    back: 'Назад',
    chooseAction: 'У вас уже есть аккаунт?',
    haveAccount: 'Есть аккаунт',
    noAccount: 'Нет аккаунта',
    sessionExpiredRestart: 'Сессия истекла. Начинаю регистрацию заново.',
    invalidSessionRestart: 'Неверная сессия входа. Начинаю регистрацию заново.',
  },
  uz: {
    askNamePrompt: "Ro'yxatdan o'tish uchun ismingizni yuboring.",
    sharePhonePrompt: "Endi ro'yxatdan o'tishni yakunlash uchun telefon raqamingizni yuboring.",
    doneOpenWebsite: 'Registratsiya tayyor. Edmissionni oching:',
    openWebsite: 'Edmissionni ochish',
  },
};

function siteUrl(path: string): string {
  return toPublicSiteUrl(path);
}

function defaultAppPathForRole(role?: string): string {
  if (role === 'student') return '/student/chat';
  if (role === 'university' || role === 'university_multi_manager') return '/university/chat';
  if (role === 'school_counsellor') return '/school/chats';
  if (role === 'admin' || role === 'manager' || role === 'counsellor_coordinator') return '/admin/chats';
  return config.telegram.notificationsPath;
}

async function createOpenAppLink(chatId: string, role?: string, nextPath?: string): Promise<string> {
  const path = nextPath || defaultAppPathForRole(role);
  try {
    const authLink = await authService.createTelegramMobileAppAuthLink(chatId, path);
    return authLink.url;
  } catch (error) {
    logger.warn({ error, chatId }, 'Failed to create Telegram app auth link');
    return siteUrl(path);
  }
}

function openAppInlineKeyboard(url: string, text = 'Open app') {
  if (!url.startsWith('https://')) {
    return {
      inline_keyboard: [[{ text, url }]],
    };
  }
  return {
    inline_keyboard: [[{ text, web_app: { url } }, { text: 'Open in browser', url }]],
  };
}

function openAppReplyButton(url: string): { text: string; web_app?: { url: string } } {
  if (!url.startsWith('https://')) return { text: MENU_OPEN_SITE };
  return { text: MENU_OPEN_SITE, web_app: { url } };
}

async function sendOpenAppAndClearKeyboard(chatId: string, state: BotState, url: string): Promise<void> {
  await removeTelegramKeyboard(chatId, t(state, 'doneOpenWebsite')).catch(() => {});
  await sendTelegramMessage(chatId, t(state, 'doneOpenWebsite'), undefined, openAppInlineKeyboard(url, t(state, 'openWebsite')));
}

function normalizeInput(input: string): string {
  return String(input ?? '').trim().toLowerCase();
}

function getLang(state: BotState): BotLang {
  return state.lang === 'uz' || state.lang === 'ru' ? state.lang : 'en';
}

function t(state: BotState, key: keyof (typeof I18N)['en']): string {
  const lang = getLang(state);
  const override = I18N_OVERRIDE[lang]?.[key];
  if (override) return override;
  return I18N[lang][key] || I18N.en[key];
}

function resolveLanguageChoice(input: string): BotLang | null {
  const normalized = normalizeInput(input);
  if (normalized.includes('рус')) return 'ru';
  if (normalized.includes('english') || normalized === 'en') return 'en';
  if (normalized.includes("o'zbek") || normalized.includes('ozbek') || normalized.includes('uzbek') || normalized === 'uz') return 'uz';
  for (const option of LANGUAGE_CHOICES) {
    if (option.labels.includes(normalized)) return option.key;
  }
  return null;
}

function isHaveAccountSelection(input: string): boolean {
  const v = normalizeInput(input);
  return [
    'login',
    'i have account',
    'есть аккаунт',
    'akkauntim bor',
    'have account',
  ].includes(v);
}

function isNoAccountSelection(input: string): boolean {
  const v = normalizeInput(input);
  return [
    'register',
    'no account',
    'нет аккаунта',
    "akkauntim yo'q",
    'akkauntim yoq',
  ].includes(v);
}

function isBackSelection(input: string): boolean {
  const v = normalizeInput(input);
  return [normalizeInput(MENU_BACK), 'назад', 'orqaga'].includes(v);
}

function isForgotPasswordSelection(input: string, state: BotState): boolean {
  const v = normalizeInput(input);
  return [
    normalizeInput(MENU_FORGOT_PASSWORD),
    normalizeInput(forgotPasswordButton(state)),
    'forgot',
    'forgot password',
    'забыл пароль',
    'parolni unutdim',
  ].includes(v);
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
  setSession(chatId, {
    mode: 'idle',
    pendingEmail: undefined,
    telegramAuthSessionId: undefined,
    telegramAuthPhone: undefined,
    telegramAuthFirstName: undefined,
    telegramAuthLastName: undefined,
    pendingStartPayload: undefined,
    pendingStartUsername: undefined,
    pendingStartFirstName: undefined,
    pendingStartLastName: undefined,
    pendingLoginVerifiedContact: undefined,
    pendingPhoneRegistrationCode: undefined,
  });
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

function isLoginIdentifierCandidate(value: string): boolean {
  return isEmailCandidate(value) || PHONE_INPUT_REGEX.test(value);
}

function loginIdentifierPrompt(state: BotState): string {
  const lang = getLang(state);
  if (lang === 'ru') return 'Введите email или отправьте номер телефона.';
  if (lang === 'uz') return 'Email yozing yoki telefon raqamingizni yuboring.';
  return 'Enter your email or share your phone number.';
}

function loginIdentifierButton(state: BotState): string {
  const lang = getLang(state);
  if (lang === 'ru') return 'Отправить номер телефона';
  if (lang === 'uz') return 'Telefon raqamni yuborish';
  return 'Share phone number';
}

function passwordPrompt(state: BotState): string {
  const lang = getLang(state);
  if (lang === 'ru') return 'Теперь введите пароль от сайта.';
  if (lang === 'uz') return 'Endi saytdagi parolingizni kiriting.';
  return 'Now enter your website password.';
}

function forgotPasswordButton(state: BotState): string {
  const lang = getLang(state);
  if (lang === 'ru') return 'Забыл пароль';
  if (lang === 'uz') return 'Parolni unutdim';
  return MENU_FORGOT_PASSWORD;
}

function noLocalPasswordPrompt(state: BotState): string {
  const lang = getLang(state);
  if (lang === 'ru') return 'Для этого аккаунта пароль ещё не создан. Нажмите "Забыл пароль", чтобы создать новый пароль.';
  if (lang === 'uz') return "Bu akkaunt uchun parol hali yaratilmagan. Yangi parol yaratish uchun \"Parolni unutdim\" tugmasini bosing.";
  return 'This account has no password yet. Tap "Forgot password" to create one.';
}

function phoneRegistrationContactPrompt(state: BotState): string {
  const lang = getLang(state);
  if (lang === 'ru') return 'Чтобы подтвердить номер для регистрации, отправьте свой номер телефона кнопкой ниже.';
  if (lang === 'uz') return "Ro'yxatdan o'tish raqamini tasdiqlash uchun telefon raqamingizni pastdagi tugma orqali yuboring.";
  return 'To confirm this registration phone, share your phone number with the button below.';
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
    MENU_SKIP_EMAIL,
    MENU_OPEN_SITE,
    MENU_RECENT,
    MENU_MARK_VIEWED,
    MENU_REPLY_HELP,
    MENU_DISCONNECT,
  ]);
  return !menuTexts.has(v);
}

async function showGuestMenu(chatId: string): Promise<void> {
  const state = getSession(chatId);
  await sendTelegramKeyboard(chatId, t(state, 'chooseAction'), [[{ text: t(state, 'noAccount') }, { text: t(state, 'haveAccount') }]]);
}

async function showLanguageMenu(chatId: string): Promise<void> {
  await sendTelegramKeyboard(chatId, `${I18N.en.chooseLanguage}\nРусский / English / O'zbek`, [
    [{ text: "O'zbek" }, { text: 'Русский' }, { text: 'English' }],
  ]);
}

async function showLanguageMenuLocalized(chatId: string): Promise<void> {
  await sendTelegramKeyboard(chatId, 'Tilni tanlang / Выберите язык / Choose language:', [
    [{ text: "O'zbek" }, { text: 'Русский' }, { text: 'English' }],
  ]);
}

async function beginTelegramWebsiteRegistrationFlow(
  chatId: string,
  username?: string,
  firstName?: string,
  lastName?: string
): Promise<void> {
  const state = getSession(chatId);
  const started = await authService.startTelegramWebsiteAuthSession({ role: 'student' });
  const bind = await authService.bindTelegramWebsiteAuthSession({
    sessionId: started.sessionId,
    telegramChatId: chatId,
    telegramUsername: username,
    firstName,
    lastName,
  });

  if (!bind.ok) {
    await sendTelegramMessage(chatId, bind.message);
    return;
  }

  if (bind.ready && bind.loginLink) {
    resetSession(chatId);
    await sendOpenAppAndClearKeyboard(chatId, state, bind.loginLink);
    return;
  }

  setSession(chatId, {
    mode: 'await_telegram_auth_name',
    pendingEmail: undefined,
    telegramAuthSessionId: started.sessionId,
    telegramAuthPhone: undefined,
    telegramAuthFirstName: undefined,
    telegramAuthLastName: undefined,
    username,
  });
  const suggestedName = [String(firstName ?? '').trim(), String(lastName ?? '').trim()]
    .filter(Boolean)
    .join(' ')
    .trim();
  await sendTelegramKeyboard(
    chatId,
    suggestedName
      ? `${t(state, 'askNamePrompt')}\nFor example: ${suggestedName}`
      : t(state, 'askNamePrompt'),
    [[{ text: t(state, 'back') }]]
  );
}

async function showLoggedInMenu(chatId: string, intro?: string): Promise<void> {
  const user = (await authService.findUserByTelegramChatId(chatId)) as LinkedUserLean | null;
  if (!user) {
    await showGuestMenu(chatId);
    return;
  }
  const name = String(user.name ?? '').trim() || 'there';
  const openUrl = await createOpenAppLink(chatId, String(user.role ?? ''));
  const line =
    intro ??
    `You are signed in as ${name}. New site messages will arrive here.`;
  await sendTelegramKeyboard(chatId, line, [
    [openAppReplyButton(openUrl), { text: MENU_RECENT }],
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
    const state = getSession(chatId);
    setSession(chatId, {
      mode: 'await_phone_registration_contact',
      pendingPhoneRegistrationCode: normalized,
      username,
    });
    await sendTelegramKeyboard(chatId, phoneRegistrationContactPrompt(state), [
      [{ text: loginIdentifierButton(state), request_contact: true }],
      [{ text: t(state, 'back') }],
    ]);
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

async function handleStart(
  chatId: string,
  payload: string,
  username?: string,
  firstName?: string,
  lastName?: string
): Promise<void> {
  const state = getSession(chatId);
  const normalizedPayload = String(payload ?? '').trim();
  if (!state.lang) {
    setSession(chatId, {
      mode: 'idle',
      pendingStartPayload: normalizedPayload,
      pendingStartUsername: username,
      pendingStartFirstName: firstName,
      pendingStartLastName: lastName,
      username,
    });
    await showLanguageMenuLocalized(chatId);
    return;
  }

  if (normalizedPayload.toUpperCase().startsWith(TELEGRAM_WEB_AUTH_START_PREFIX)) {
    const sessionId = normalizedPayload.slice(TELEGRAM_WEB_AUTH_START_PREFIX.length).trim().toLowerCase();
    if (!TELEGRAM_WEB_AUTH_SESSION_ID_REGEX.test(sessionId)) {
      await sendTelegramMessage(chatId, t(state, 'invalidSessionRestart'));
      await beginTelegramWebsiteRegistrationFlow(chatId, username, firstName, lastName);
      return;
    }

    const bind = await authService.bindTelegramWebsiteAuthSession({
      sessionId,
      telegramChatId: chatId,
      telegramUsername: username,
      firstName,
      lastName,
    });
    if (!bind.ok) {
      if (bind.message.toLowerCase().includes('session expired')) {
        await sendTelegramMessage(chatId, t(state, 'sessionExpiredRestart'));
        await beginTelegramWebsiteRegistrationFlow(chatId, username, firstName, lastName);
        return;
      }
      await sendTelegramMessage(chatId, bind.message);
      return;
    }

    if (bind.ready && bind.loginLink) {
      resetSession(chatId);
      await sendOpenAppAndClearKeyboard(chatId, state, bind.loginLink);
      return;
    }

    setSession(chatId, {
      mode: 'await_telegram_auth_name',
      pendingEmail: undefined,
      telegramAuthSessionId: sessionId,
      telegramAuthPhone: undefined,
      telegramAuthFirstName: undefined,
      telegramAuthLastName: undefined,
      username,
    });
    const suggestedName = [String(firstName ?? '').trim(), String(lastName ?? '').trim()]
      .filter(Boolean)
      .join(' ')
      .trim();
    await sendTelegramKeyboard(
      chatId,
      suggestedName
        ? `${t(state, 'askNamePrompt')}\nFor example: ${suggestedName}`
        : t(state, 'askNamePrompt'),
      [[{ text: t(state, 'back') }]]
    );
    return;
  }

  if (!normalizedPayload) {
    resetSession(chatId);
    const user = (await authService.findUserByTelegramChatId(chatId)) as LinkedUserLean | null;
    if (user) {
      const name = String(user.name ?? '').trim() || 'there';
      await showLoggedInMenu(chatId, `Welcome back, ${name}.`);
      return;
    }
    setSession(chatId, { mode: 'idle', username });
    await showGuestMenu(chatId);
    return;
  }

  await tryLinkByPayload(chatId, normalizedPayload, username);
  setSession(chatId, { mode: 'idle', pendingEmail: undefined, telegramAuthSessionId: undefined, username });
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
      '3) Enter your website email/phone and password',
      '4) Site messages will be delivered here',
      '',
      `Website login page: ${loginUrl}`,
      '/start - main menu',
    ].join('\n')
  );
  await showGuestMenu(chatId);
}

async function handleLoginEntry(chatId: string): Promise<void> {
  const state = getSession(chatId);
  const lockRemainingMs = getLoginLockRemainingMs(chatId);
  if (lockRemainingMs > 0) {
    const waitMin = Math.ceil(lockRemainingMs / 60_000);
    await sendTelegramMessage(chatId, `Too many failed attempts. Try again in about ${waitMin} minute(s).`);
    return;
  }
  setSession(chatId, { mode: 'await_login_email', pendingEmail: undefined });
  await sendTelegramKeyboard(chatId, loginIdentifierPrompt(state), [
    [{ text: loginIdentifierButton(state), request_contact: true }],
    [{ text: t(state, 'back') }],
  ]);
}

async function handleEmailInput(
  chatId: string,
  emailInput: string,
  options: { verifiedTelegramContact?: boolean } = {}
): Promise<void> {
  const state = getSession(chatId);
  const lockRemainingMs = getLoginLockRemainingMs(chatId);
  if (lockRemainingMs > 0) {
    const waitMin = Math.ceil(lockRemainingMs / 60_000);
    await sendTelegramMessage(chatId, `Too many failed attempts. Try again in about ${waitMin} minute(s).`);
    return;
  }

  const rawIdentifier = emailInput.trim();
  const identifier = isEmailCandidate(rawIdentifier) ? rawIdentifier.toLowerCase() : rawIdentifier;
  if (identifier.length > MAX_EMAIL_LENGTH) {
    await sendTelegramMessage(chatId, 'Email/phone is too long.');
    return;
  }
  if (!isLoginIdentifierCandidate(identifier)) {
    await sendTelegramKeyboard(chatId, loginIdentifierPrompt(state), [
      [{ text: loginIdentifierButton(state), request_contact: true }],
      [{ text: t(state, 'back') }],
    ]);
    return;
  }
  if (options.verifiedTelegramContact === true && PHONE_INPUT_REGEX.test(identifier)) {
    const result = await authService.createTelegramVerifiedPhoneAuthLink({
      phone: identifier,
      telegramChatId: chatId,
      telegramUsername: state.username,
    });
    if (result.ok && result.loginLink) {
      resetSession(chatId);
      await sendOpenAppAndClearKeyboard(chatId, state, result.loginLink);
      return;
    }
    await sendTelegramKeyboard(chatId, result.message, [
      [{ text: forgotPasswordButton(state) }],
      [{ text: t(state, 'back') }],
    ]);
    setSession(chatId, {
      mode: 'await_login_password',
      pendingEmail: identifier,
      pendingLoginVerifiedContact: true,
    });
    return;
  }
  const requirement = await authService.getTelegramLoginRequirement(identifier);
  setSession(chatId, {
    mode: 'await_login_password',
    pendingEmail: identifier,
    pendingLoginVerifiedContact: options.verifiedTelegramContact === true,
  });
  if (requirement.exists && !requirement.localPasswordConfigured) {
    await sendTelegramKeyboard(chatId, noLocalPasswordPrompt(state), [
      [{ text: forgotPasswordButton(state) }],
      [{ text: t(state, 'back') }],
    ]);
    return;
  }
  await sendTelegramKeyboard(chatId, passwordPrompt(state), [
    [{ text: forgotPasswordButton(state) }],
    [{ text: t(state, 'back') }],
  ]);
}

function resolveLoginErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    if (
      error.code === ErrorCodes.UNAUTHORIZED ||
      error.code === ErrorCodes.FORBIDDEN ||
      error.code === ErrorCodes.VALIDATION
    ) {
      return 'Invalid email/phone or password.';
    }
  }
  return 'Login failed. Please try again.';
}

async function handleForgotPasswordInBot(chatId: string, state: BotState, username?: string): Promise<void> {
  const identifier = String(state.pendingEmail ?? '').trim();
  if (!identifier) {
    await sendTelegramMessage(chatId, 'Login session expired. Tap Login again.');
    resetSession(chatId);
    await showGuestMenu(chatId);
    return;
  }

  const result = await authService.createTelegramPasswordResetLink({
    identifier,
    telegramChatId: chatId,
    telegramUsername: username ?? state.username,
    verifiedPhoneContact: state.pendingLoginVerifiedContact === true,
  });

  await sendTelegramMessage(chatId, result.message, undefined, result.resetLink ? openAppInlineKeyboard(result.resetLink, 'Create password') : undefined);
  resetSession(chatId);
  await showGuestMenu(chatId);
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
  const identifier = String(state.pendingEmail ?? '').trim();
  if (!identifier) {
    await sendTelegramMessage(chatId, 'Login session expired. Tap Login again.');
    resetSession(chatId);
    await showGuestMenu(chatId);
    return;
  }
  if (isForgotPasswordSelection(passwordInput, state)) {
    await handleForgotPasswordInBot(chatId, state, username);
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
    const user = await authService.authenticateTelegramCredentials(identifier, password);
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
  replyToMessageId?: number,
  firstName?: string,
  lastName?: string
): Promise<void> {
  const normalized = text.trim();
  if (!normalized) return;

  const state = getSession(chatId);
  const isStatefulInput = normalized.startsWith('/start') || state.mode !== 'idle' || Boolean(replyToMessageId);
  if (!isStatefulInput && isRateLimited(chatId)) return;

  if (state.mode !== 'await_login_password' && normalized.length > MAX_TEXT_LENGTH) {
    await sendTelegramMessage(chatId, `Message is too long. Maximum ${MAX_TEXT_LENGTH} characters.`);
    return;
  }

  setSession(chatId, { username: username ?? state.username });

  if (normalized.startsWith('/start')) {
    const payload = extractStartPayload(normalized);
    await handleStart(chatId, payload, username, firstName, lastName);
    return;
  }

  if (!state.lang && state.mode === 'idle') {
    const linkedBeforeLang = await authService.findUserByTelegramChatId(chatId);
    if (!linkedBeforeLang || state.pendingStartPayload !== undefined) {
      const selectedLang = resolveLanguageChoice(normalized);
      if (!selectedLang) {
        await showLanguageMenuLocalized(chatId);
        return;
      }
      const hasPendingStart = state.pendingStartPayload !== undefined;
      const pendingPayload = String(state.pendingStartPayload ?? '');
      const pendingUsername = state.pendingStartUsername ?? username;
      const pendingFirstName = state.pendingStartFirstName ?? firstName;
      const pendingLastName = state.pendingStartLastName ?? lastName;
      setSession(chatId, {
        lang: selectedLang,
        mode: 'idle',
        pendingStartPayload: undefined,
        pendingStartUsername: undefined,
        pendingStartFirstName: undefined,
        pendingStartLastName: undefined,
      });
      const nextState = getSession(chatId);
      await removeTelegramKeyboard(chatId, t(nextState, 'languageSaved')).catch(() => {});
      if (hasPendingStart) {
        await handleStart(chatId, pendingPayload, pendingUsername, pendingFirstName, pendingLastName);
        return;
      }
      await showGuestMenu(chatId);
      return;
    }
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

  if (isBackSelection(normalized)) {
    resetSession(chatId);
    if (linkedUser) await showLoggedInMenu(chatId);
    else await showGuestMenu(chatId);
    return;
  }

  if (state.mode === 'await_phone_registration_contact') {
    if (PHONE_INPUT_REGEX.test(normalized)) {
      await handlePhoneRegistrationContactMessage(chatId, normalized, username);
      return;
    }
    await sendTelegramKeyboard(chatId, phoneRegistrationContactPrompt(state), [
      [{ text: loginIdentifierButton(state), request_contact: true }],
      [{ text: t(state, 'back') }],
    ]);
    return;
  }

  if (state.mode === 'await_telegram_auth_contact') {
    if (PHONE_INPUT_REGEX.test(normalized)) {
      await handleContactMessage(chatId, normalized, username, firstName, lastName);
      return;
    }
    await sendTelegramKeyboard(chatId, t(state, 'sharePhonePrompt'), [
      [{ text: t(state, 'sharePhoneButton'), request_contact: true }],
      [{ text: t(state, 'back') }],
    ]);
    return;
  }

  if (state.mode === 'await_telegram_auth_name') {
    await handleTelegramAuthNameMessage(chatId, state, normalized, username, firstName, lastName);
    return;
  }

  if (state.mode === 'await_telegram_auth_email') {
    await handleTelegramAuthEmailMessage(chatId, state, normalized, username);
    return;
  }

  if (linkedUser) {
    if (normalized === MENU_OPEN_SITE) {
      const role = String(linkedUser.role ?? '');
      const openPath = defaultAppPathForRole(role);
      const openUrl = await createOpenAppLink(chatId, role, openPath);
      await sendTelegramMessage(chatId, 'Open Edmission:', undefined, openAppInlineKeyboard(openUrl));
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

    if (isHaveAccountSelection(normalized) || isNoAccountSelection(normalized)) {
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

  if (isNoAccountSelection(normalized)) {
    resetSession(chatId);
    await beginTelegramWebsiteRegistrationFlow(chatId, username, firstName, lastName);
    return;
  }

  if (isHaveAccountSelection(normalized)) {
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

  await sendTelegramMessage(chatId, t(state, 'chooseAction'));
  await showGuestMenu(chatId);
}

async function handleContactMessage(
  chatId: string,
  phone: string,
  username?: string,
  firstName?: string,
  lastName?: string
): Promise<void> {
  const state = getSession(chatId);
  let sessionId = String(state.telegramAuthSessionId ?? '').trim().toLowerCase();
  const inPhoneCollectionMode =
    state.mode === 'await_telegram_auth_contact' || state.mode === 'await_telegram_auth_name';

  if (!TELEGRAM_WEB_AUTH_SESSION_ID_REGEX.test(sessionId)) {
    const restoredSessionId = await authService.findLatestTelegramWebsiteAuthSessionIdByChatId(chatId);
    if (restoredSessionId) {
      sessionId = restoredSessionId;
    }
  }

  if (!TELEGRAM_WEB_AUTH_SESSION_ID_REGEX.test(sessionId)) {
    try {
      const started = await authService.startTelegramWebsiteAuthSession({ role: 'student' });
      const bind = await authService.bindTelegramWebsiteAuthSession({
        sessionId: started.sessionId,
        telegramChatId: chatId,
        telegramUsername: username,
        firstName,
        lastName,
      });
      if (!bind.ok) {
        await sendTelegramMessage(chatId, bind.message);
        return;
      }
      sessionId = started.sessionId;
    } catch {
      await sendTelegramMessage(chatId, 'Could not start registration session. Try again in a moment.');
      return;
    }
  }

  const sessionState = getSession(chatId);

  if (!inPhoneCollectionMode) {
    setSession(chatId, {
      mode: 'await_telegram_auth_contact',
      telegramAuthSessionId: sessionId,
      telegramAuthPhone: undefined,
      username: username ?? state.username,
    });
  }

  const phoneInput = String(phone ?? '').trim();
  if (!PHONE_INPUT_REGEX.test(phoneInput)) {
    await sendTelegramKeyboard(chatId, t(sessionState, 'sharePhonePrompt'), [
      [{ text: t(sessionState, 'sharePhoneButton'), request_contact: true }],
      [{ text: t(sessionState, 'back') }],
    ]);
    return;
  }

  if (String(state.telegramAuthFirstName ?? '').trim() || String(state.telegramAuthLastName ?? '').trim()) {
    const result = await authService.completeTelegramWebsiteAuthFromBot({
      sessionId,
      telegramChatId: chatId,
      phone: phoneInput,
      telegramUsername: username ?? state.username,
      firstName: state.telegramAuthFirstName,
      lastName: state.telegramAuthLastName,
    });

    if (!result.ok) {
      resetSession(chatId);
      await sendTelegramMessage(chatId, result.message);
      return;
    }

    resetSession(chatId);
    if (result.loginLink) {
      await sendOpenAppAndClearKeyboard(chatId, sessionState, result.loginLink);
      return;
    }
    await sendTelegramMessage(chatId, 'Done. Return to the website.');
    return;
  }

  setSession(chatId, {
    mode: 'await_telegram_auth_name',
    telegramAuthSessionId: sessionId,
    telegramAuthPhone: phoneInput,
    telegramAuthFirstName: undefined,
    telegramAuthLastName: undefined,
    username: username ?? state.username,
  });
  const suggestedName = [String(firstName ?? '').trim(), String(lastName ?? '').trim()]
    .filter(Boolean)
    .join(' ')
    .trim();
  await sendTelegramKeyboard(
    chatId,
    suggestedName
      ? `${t(sessionState, 'askNamePrompt')}\nFor example: ${suggestedName}`
      : t(sessionState, 'askNamePrompt'),
    [[{ text: t(sessionState, 'back') }]]
  );
}

async function handlePhoneRegistrationContactMessage(
  chatId: string,
  phone: string,
  username?: string
): Promise<void> {
  const state = getSession(chatId);
  const registrationCode = String(state.pendingPhoneRegistrationCode ?? '').trim();
  if (!REGISTRATION_CODE_REGEX.test(registrationCode)) {
    resetSession(chatId);
    await sendTelegramMessage(chatId, 'Registration session expired. Return to the website and try again.');
    await showGuestMenu(chatId);
    return;
  }

  const result = await authService.verifyPhoneRegistrationByTelegram(registrationCode, chatId, username || state.username || '', phone);
  if (!result.ok) {
    await sendTelegramKeyboard(chatId, result.message, [
      [{ text: loginIdentifierButton(state), request_contact: true }],
      [{ text: t(state, 'back') }],
    ]);
    return;
  }

  resetSession(chatId);
  await removeTelegramKeyboard(chatId, result.message).catch(() => {});
}

function splitNameForSession(input: string): { firstName?: string; lastName?: string } {
  const normalized = String(input ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!normalized) return {};
  const parts = normalized.split(' ').filter(Boolean);
  if (parts.length === 0) return {};
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ').trim();
  return {
    firstName,
    ...(lastName ? { lastName } : {}),
  };
}

async function handleTelegramAuthNameMessage(
  chatId: string,
  state: BotState,
  rawName: string,
  username?: string,
  firstName?: string,
  lastName?: string
): Promise<void> {
  const sessionState = getSession(chatId);
  let sessionId = String(state.telegramAuthSessionId ?? '').trim().toLowerCase();

  if (!TELEGRAM_WEB_AUTH_SESSION_ID_REGEX.test(sessionId)) {
    const restoredSessionId = await authService.findLatestTelegramWebsiteAuthSessionIdByChatId(chatId);
    if (restoredSessionId) sessionId = restoredSessionId;
  }
  if (!TELEGRAM_WEB_AUTH_SESSION_ID_REGEX.test(sessionId)) {
    resetSession(chatId);
    await sendTelegramMessage(chatId, t(sessionState, 'sessionExpiredRestart'));
    await beginTelegramWebsiteRegistrationFlow(chatId, username, firstName, lastName);
    return;
  }
  if (PHONE_INPUT_REGEX.test(rawName)) {
    await sendTelegramKeyboard(chatId, 'Please send your name first. Phone number comes next.', [[{ text: MENU_BACK }]]);
    return;
  }

  const typedName = String(rawName ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const fallbackName = [String(firstName ?? '').trim(), String(lastName ?? '').trim()].filter(Boolean).join(' ').trim();
  const resolvedName = typedName || fallbackName;
  if (resolvedName.length < 2) {
    await sendTelegramKeyboard(chatId, 'Please send your name (at least 2 characters).', [[{ text: MENU_BACK }]]);
    return;
  }

  const nameParts = splitNameForSession(resolvedName);
  const savedPhoneInput = String(state.telegramAuthPhone ?? '').trim();
  if (PHONE_INPUT_REGEX.test(savedPhoneInput)) {
    const result = await authService.completeTelegramWebsiteAuthFromBot({
      sessionId,
      telegramChatId: chatId,
      phone: savedPhoneInput,
      telegramUsername: username ?? state.username,
      firstName: nameParts.firstName,
      lastName: nameParts.lastName,
    });
    resetSession(chatId);
    if (!result.ok) {
      await sendTelegramMessage(chatId, result.message);
      return;
    }
    if (result.loginLink) {
      await sendOpenAppAndClearKeyboard(chatId, sessionState, result.loginLink);
      return;
    }
    await sendTelegramMessage(chatId, 'Done. Return to the website.');
    return;
  }

  setSession(chatId, {
    mode: 'await_telegram_auth_contact',
    telegramAuthSessionId: sessionId,
    telegramAuthPhone: undefined,
    telegramAuthFirstName: nameParts.firstName,
    telegramAuthLastName: nameParts.lastName,
    username: username ?? state.username,
  });
  await sendTelegramKeyboard(chatId, t(sessionState, 'sharePhonePrompt'), [
    [{ text: t(sessionState, 'sharePhoneButton'), request_contact: true }],
    [{ text: MENU_BACK }],
  ]);
}

async function handleTelegramAuthEmailMessage(
  chatId: string,
  state: BotState,
  rawEmail: string,
  username?: string
): Promise<void> {
  const sessionState = getSession(chatId);
  let sessionId = String(state.telegramAuthSessionId ?? '').trim().toLowerCase();
  const phoneInput = String(state.telegramAuthPhone ?? '').trim();

  if (!TELEGRAM_WEB_AUTH_SESSION_ID_REGEX.test(sessionId)) {
    const restoredSessionId = await authService.findLatestTelegramWebsiteAuthSessionIdByChatId(chatId);
    if (restoredSessionId) sessionId = restoredSessionId;
  }
  if (!TELEGRAM_WEB_AUTH_SESSION_ID_REGEX.test(sessionId) || !PHONE_INPUT_REGEX.test(phoneInput)) {
    resetSession(chatId);
    await sendTelegramMessage(chatId, t(sessionState, 'sessionExpiredRestart'));
    await beginTelegramWebsiteRegistrationFlow(chatId, username ?? state.username);
    return;
  }

  const normalized = String(rawEmail ?? '').trim();
  const skip = normalizeInput(normalized) === normalizeInput(MENU_SKIP_EMAIL) || normalizeInput(normalized) === normalizeInput(t(sessionState, 'skipEmail'));
  const email = skip ? '' : normalized.toLowerCase();
  if (email && !isEmailCandidate(email)) {
    await sendTelegramKeyboard(chatId, 'Please send a valid email or tap Skip email.', [
      [{ text: t(sessionState, 'skipEmail') }],
      [{ text: MENU_BACK }],
    ]);
    return;
  }

  const result = await authService.completeTelegramWebsiteAuthFromBot({
    sessionId,
    telegramChatId: chatId,
    phone: phoneInput,
    telegramUsername: username ?? state.username,
    firstName: state.telegramAuthFirstName,
    lastName: state.telegramAuthLastName,
    email,
  });

  if (!result.ok) {
    resetSession(chatId);
    await sendTelegramMessage(chatId, result.message);
    return;
  }

  resetSession(chatId);
  if (result.loginLink) {
    await sendOpenAppAndClearKeyboard(chatId, sessionState, result.loginLink);
    return;
  }
  await sendTelegramMessage(chatId, 'Done. Return to the website.');
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
      const contactUserId = update.message?.contact?.user_id;
      const username = update.message?.from?.username;
      const firstName = update.message?.from?.first_name;
      const lastName = update.message?.from?.last_name;
      const replyToMessageId = update.message?.reply_to_message?.message_id;
      const chatId = chatIdRaw != null ? String(chatIdRaw).trim() : '';
      if (!chatId) continue;
      try {
        if (typeof phone === 'string' && phone.trim()) {
          const state = getSession(chatId);
          if (state.mode === 'await_phone_registration_contact') {
            await handlePhoneRegistrationContactMessage(chatId, phone, username);
            continue;
          }
          if (state.mode === 'await_login_email') {
            await handleEmailInput(chatId, phone, {
              verifiedTelegramContact: String(contactUserId ?? '') === chatId,
            });
            continue;
          }
          await handleContactMessage(chatId, phone, username, firstName, lastName);
          continue;
        }
        if (typeof text === 'string') {
          await handleTextMessage(chatId, text, username, replyToMessageId, firstName, lastName);
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

async function clearTelegramWebhookForPolling(token: string): Promise<void> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drop_pending_updates: false }),
    });
    if (!response.ok) {
      const body = await response.text();
      logger.warn({ status: response.status, body }, 'Telegram deleteWebhook failed');
      return;
    }
    const data = (await response.json()) as { ok?: boolean; description?: string };
    if (!data.ok) {
      logger.warn({ description: data.description }, 'Telegram deleteWebhook returned not ok');
    }
  } catch (error) {
    logger.warn({ error }, 'Telegram deleteWebhook error');
  }
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
  void clearTelegramWebhookForPolling(token).finally(() => void pollUpdates());
}
