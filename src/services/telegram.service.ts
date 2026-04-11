<<<<<<< Updated upstream
import crypto from 'crypto';
import { Chat, TelegramChatPreference, TelegramMessageLink, User } from '../models';
import { config } from '../config';
import { logger } from '../utils/logger';

type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id?: number | string };
    from?: { username?: string };
    message_id?: number;
    reply_to_message?: { message_id?: number };
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: {
      chat?: { id?: number | string };
    };
  };
};

type BotLang = 'ru' | 'en' | 'uz';

let pollingTimer: NodeJS.Timeout | null = null;
let updateOffset = 0;
let pollingInProgress = false;

function hasTelegramConfigured(): boolean {
  return Boolean(config.telegram.botToken);
}

function getBotLink(): string {
  const username = config.telegram.botUsername;
  return username ? `https://t.me/${username}` : 'https://t.me/';
}

async function telegramGet(method: string, query: Record<string, string | number>): Promise<any> {
  const token = config.telegram.botToken;
  const url = new URL(`https://api.telegram.org/bot${token}/${method}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString());
  return res.json();
}

async function telegramPost(method: string, body: Record<string, unknown>): Promise<any> {
  const token = config.telegram.botToken;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  if (!callbackQueryId) return;
  try {
    await telegramPost('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...(text ? { text } : {}),
    });
  } catch {
    // ignore
  }
}

async function sendTelegramText(
  chatId: string,
  text: string,
  options?: { replyMarkup?: Record<string, unknown> }
): Promise<{ ok?: boolean; result?: { message_id?: number } } | null> {
  if (!hasTelegramConfigured()) return null;
  try {
    const result = await telegramPost('sendMessage', {
      chat_id: chatId,
      text,
      ...(options?.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
    if (!result?.ok) {
      logger.warn({ result }, 'Telegram sendMessage failed');
    }
    return result;
  } catch (error) {
    logger.warn({ error }, 'Telegram sendMessage exception');
    return null;
  }
}

async function getChatLanguage(chatId: string): Promise<{ lang: BotLang; selected: boolean }> {
  const pref = await TelegramChatPreference.findOne({ telegramChatId: chatId }).lean();
  if (!pref) return { lang: 'ru', selected: false };
  const p = pref as { language?: BotLang; languageSelected?: boolean };
  return { lang: p.language || 'ru', selected: Boolean(p.languageSelected) };
}

async function ensureChatLanguage(chatId: string): Promise<void> {
  await TelegramChatPreference.updateOne(
    { telegramChatId: chatId },
    { $setOnInsert: { telegramChatId: chatId, language: 'ru', languageSelected: false } },
    { upsert: true }
  );
}

async function setChatLanguage(chatId: string, lang: BotLang): Promise<void> {
  await TelegramChatPreference.updateOne(
    { telegramChatId: chatId },
    { $set: { language: lang, languageSelected: true } },
    { upsert: true }
  );
}

function detectLanguageChoice(text: string): BotLang | null {
  const raw = text.trim().toLowerCase();
  if (['ru', 'русский', 'russian'].includes(raw)) return 'ru';
  if (['en', 'english', 'английский'].includes(raw)) return 'en';
  if (['uz', "o'zbek", 'uzbek', 'узбекский'].includes(raw)) return 'uz';
  return null;
}

function tr(lang: BotLang, key: string): string {
  const dict: Record<BotLang, Record<string, string>> = {
    ru: {
      chooseLanguage: 'Выберите язык:\nРусский / English / O\'zbek',
      linked: 'Telegram подключен. Теперь вы будете получать сообщения Edmission здесь.',
      invalidCode: 'Код недействителен или истек. Сгенерируйте новый код в Edmission.',
      notLinked: 'Этот Telegram еще не привязан. Сначала привяжите аккаунт в Edmission.',
      sent: 'Отправлено.',
      empty: 'Сообщение не должно быть пустым.',
      unknown: 'Не понял сообщение. Напишите /help',
      help: 'Команды:\n/help\n/chats\n/readall\n\nМожно просто ответить (Reply) на входящее сообщение от бота.',
      readAllDone: 'Готово. Все чаты отмечены как прочитанные.',
      chatsEmpty: 'У вас пока нет чатов.',
      chooseFromStart: 'Сначала выберите язык: Русский / English / O\'zbek',
    },
    en: {
      chooseLanguage: 'Choose language:\nРусский / English / O\'zbek',
      linked: 'Telegram connected. You will now receive Edmission messages here.',
      invalidCode: 'Code is invalid or expired. Generate a new code in Edmission.',
      notLinked: 'This Telegram is not linked yet. Link your account in Edmission first.',
      sent: 'Sent.',
      empty: 'Message cannot be empty.',
      unknown: 'Unknown input. Send /help',
      help: 'Commands:\n/help\n/chats\n/readall\n\nYou can simply reply to incoming bot message.',
      readAllDone: 'Done. All chats marked as read.',
      chatsEmpty: 'No chats yet.',
      chooseFromStart: 'Please choose language first: Русский / English / O\'zbek',
    },
    uz: {
      chooseLanguage: 'Tilni tanlang:\nРусский / English / O\'zbek',
      linked: 'Telegram ulandi. Endi Edmission xabarlari shu yerga keladi.',
      invalidCode: 'Kod noto‘g‘ri yoki eskirgan. Edmission ichida yangi kod yarating.',
      notLinked: 'Bu Telegram hali ulanmagan. Avval Edmissionda ulang.',
      sent: 'Yuborildi.',
      empty: 'Xabar bo‘sh bo‘lmasin.',
      unknown: 'Tushunmadim. /help yuboring',
      help: 'Buyruqlar:\n/help\n/chats\n/readall\n\nBot xabariga Reply qilish ham mumkin.',
      readAllDone: 'Tayyor. Barcha chatlar o‘qilgan deb belgilandi.',
      chatsEmpty: 'Hozircha chat yo‘q.',
      chooseFromStart: 'Avval tilni tanlang: Русский / English / O\'zbek',
    },
  };
  return dict[lang][key] || dict.ru[key] || key;
}

async function linkUserByCode(chatId: string, username: string, code: string): Promise<boolean> {
  const user = await User.findOne({
    'telegram.linkCode': code,
    'telegram.linkCodeExpiresAt': { $gt: new Date() },
  });
  if (!user) return false;

  user.set({
    'telegram.chatId': chatId,
    'telegram.username': username || '',
    'telegram.linkedAt': new Date(),
    'telegram.linkCode': '',
    'telegram.linkCodeExpiresAt': null,
  });
  await user.save();
  return true;
}

async function handleReplyCommand(appUserId: string, text: string): Promise<{ ok: boolean; text: string }> {
  const match = text.match(/^\/reply\s+([a-fA-F0-9]{24})\s+([\s\S]+)/);
  if (!match) {
    return {
      ok: false,
      text: 'Format: /reply <chatId> <your message>',
    };
  }
  const chatId = match[1];
  const body = match[2].trim();
  if (!body) {
    return { ok: false, text: 'Message cannot be empty.' };
  }

  const chatService = await import('./chat.service');
  const chats = await chatService.getChats(appUserId);
  const canAccess = (chats as Array<{ id?: string }>).some((c) => String(c.id) === chatId);
  if (!canAccess) {
    return { ok: false, text: 'Chat not found for your account.' };
  }

  await chatService.saveMessage(chatId, appUserId, body);
  return { ok: true, text: `Sent to chat ${chatId}.` };
}

async function handleReplyToTelegramMessage(
  appUserId: string,
  telegramChatId: string,
  replyToMessageId: number,
  text: string
): Promise<{ ok: boolean; text: string }> {
  if (!text.trim()) return { ok: false, text: 'Message cannot be empty.' };
  const link = await TelegramMessageLink.findOne({
    telegramChatId,
    telegramMessageId: replyToMessageId,
    userId: appUserId,
    expiresAt: { $gt: new Date() },
  }).lean();
  if (!link) {
    return { ok: false, text: 'Cannot determine chat from this message. Use /chats or /reply <chatId> <message>.' };
  }
  const chatService = await import('./chat.service');
  await chatService.saveMessage(String((link as { appChatId: unknown }).appChatId), appUserId, text.trim());
  return { ok: true, text: 'Sent.' };
}

async function listChatsForTelegram(appUserId: string): Promise<string> {
  const chatService = await import('./chat.service');
  const chats = await chatService.getChats(appUserId);
  const rows = (chats as Array<Record<string, unknown>>).slice(0, 8).map((c) => {
    const id = String(c.id || c._id || '');
    const universityName = (c.university as { universityName?: string } | undefined)?.universityName;
    const student = c.student as { firstName?: string; lastName?: string } | undefined;
    const title = universityName || [student?.firstName, student?.lastName].filter(Boolean).join(' ') || 'Chat';
    return `• ${title}\n  id: ${id}\n  reply: /reply ${id} your message`;
  });
  if (rows.length === 0) return 'No chats yet.';
  return `Your recent chats:\n\n${rows.join('\n\n')}`;
}

async function markAllChatsRead(appUserId: string): Promise<number> {
  const chatService = await import('./chat.service');
  const chats = await chatService.getChats(appUserId);
  let count = 0;
  for (const chat of chats as Array<{ id?: string }>) {
    const chatId = String(chat.id || '');
    if (!chatId) continue;
    await chatService.markRead(chatId, appUserId);
    count += 1;
  }
  return count;
}

function helpText(): string {
  return [
    'Edmission bot commands:',
    '/help - show commands',
    '/chats - list your recent chats',
    '/readall - mark all chats as read',
    '/reply <chatId> <text> - send message to chat',
    '',
    'Tip: you can also tap "Reply" on any incoming bot message and send text directly.',
  ].join('\n');
}

async function processUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query?.data?.startsWith('lang:')) {
    const data = update.callback_query.data;
    const callbackId = String(update.callback_query.id || '');
    const cbChatId = update.callback_query.message?.chat?.id;
    if (cbChatId == null) {
      await answerCallbackQuery(callbackId);
      return;
    }
    const chatId = String(cbChatId);
    const lang = data.replace('lang:', '') as BotLang;
    if (!['ru', 'en', 'uz'].includes(lang)) {
      await answerCallbackQuery(callbackId);
      return;
    }
    await setChatLanguage(chatId, lang);
    await answerCallbackQuery(callbackId, 'Language saved');
    await sendTelegramText(chatId, tr(lang, 'help'));
    return;
  }

  const text = (update.message?.text || '').trim();
  const rawChatId = update.message?.chat?.id;
  if (!text || rawChatId == null) return;
  const chatId = String(rawChatId);
  const username = String(update.message?.from?.username || '');
  await ensureChatLanguage(chatId);
  const pref = await getChatLanguage(chatId);
  const lang = pref.lang;

  if (text.startsWith('/start')) {
    const payload = text.replace('/start', '').trim();
    if (!pref.selected) {
      await sendTelegramText(chatId, tr(lang, 'chooseLanguage'), {
        replyMarkup: {
          inline_keyboard: [
            [
              { text: 'Русский', callback_data: 'lang:ru' },
              { text: 'English', callback_data: 'lang:en' },
              { text: "O'zbek", callback_data: 'lang:uz' },
            ],
          ],
        },
      });
      return;
    }
    if (payload) {
      if (payload.startsWith('reg_')) {
        const authService = await import('./auth.service');
        const result = await authService.verifyPhoneRegistrationByTelegram(payload, chatId, username);
        await sendTelegramText(chatId, result.message);
        return;
      }
      const linked = await linkUserByCode(chatId, username, payload);
      if (linked) {
        await sendTelegramText(chatId, tr(lang, 'linked'));
      } else {
        await sendTelegramText(chatId, tr(lang, 'invalidCode'));
      }
      return;
    }
    await sendTelegramText(chatId, tr(lang, 'help'));
    return;
  }

  if (!pref.selected) {
    const chosen = detectLanguageChoice(text);
    if (chosen) {
      await setChatLanguage(chatId, chosen);
      await sendTelegramText(chatId, tr(chosen, 'help'), {
        replyMarkup: { remove_keyboard: true },
      });
      return;
    }
    await sendTelegramText(chatId, tr(lang, 'chooseFromStart'));
    return;
  }

  const user = await User.findOne({ 'telegram.chatId': chatId }).select('_id').lean();
  if (!user) {
    await sendTelegramText(chatId, tr(lang, 'notLinked'));
    return;
  }
  const appUserId = String((user as { _id: unknown })._id);

  if (text.startsWith('/help')) {
    await sendTelegramText(chatId, tr(lang, 'help'));
    return;
  }

  if (text.startsWith('/chats')) {
    const textOut = await listChatsForTelegram(appUserId);
    await sendTelegramText(chatId, textOut);
    return;
  }

  if (text.startsWith('/readall')) {
    const count = await markAllChatsRead(appUserId);
    await sendTelegramText(chatId, `${tr(lang, 'readAllDone')} (${count})`);
    return;
  }

  if (text.startsWith('/reply')) {
    const result = await handleReplyCommand(appUserId, text);
    await sendTelegramText(chatId, result.ok ? tr(lang, 'sent') : result.text);
    return;
  }

  const replyTo = update.message?.reply_to_message?.message_id;
  if (replyTo && text) {
    const result = await handleReplyToTelegramMessage(appUserId, chatId, Number(replyTo), text);
    await sendTelegramText(chatId, result.ok ? tr(lang, 'sent') : result.text);
    return;
  }

  await sendTelegramText(chatId, tr(lang, 'unknown'));
}

async function pollTelegramUpdates(): Promise<void> {
  if (!hasTelegramConfigured() || pollingInProgress) return;
  pollingInProgress = true;
  try {
    const data = await telegramGet('getUpdates', {
      offset: updateOffset,
      timeout: 20,
      allowed_updates: JSON.stringify(['message', 'callback_query']),
    });
    if (!data?.ok || !Array.isArray(data.result)) return;
    for (const update of data.result as TelegramUpdate[]) {
      updateOffset = Math.max(updateOffset, Number(update.update_id) + 1);
      await processUpdate(update);
    }
  } catch (error) {
    logger.warn({ error }, 'Telegram polling failed');
  } finally {
    pollingInProgress = false;
  }
}

export function startTelegramBot(): void {
  if (!hasTelegramConfigured()) {
    logger.info('Telegram bot is disabled: TELEGRAM_BOT_TOKEN is missing');
    return;
  }
  if (pollingTimer) return;
  pollTelegramUpdates().catch(() => {});
  pollingTimer = setInterval(() => {
    pollTelegramUpdates().catch(() => {});
  }, config.telegram.pollingIntervalMs);
  logger.info('Telegram bot polling started');
}

export async function createTelegramLinkCode(userId: string): Promise<{ code: string; expiresAt: string; deepLink: string }> {
  const code = crypto.randomBytes(16).toString('hex');
  const expiresAtDate = new Date(Date.now() + 10 * 60 * 1000);
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'telegram.linkCode': code,
        'telegram.linkCodeExpiresAt': expiresAtDate,
      },
    }
  );
  const username = config.telegram.botUsername;
  const deepLink = username ? `https://t.me/${username}?start=${code}` : code;
  return {
    code,
    expiresAt: expiresAtDate.toISOString(),
    deepLink,
  };
}

export async function getTelegramStatus(userId: string): Promise<{ connected: boolean; username: string; linkedAt: string | null }> {
  const user = await User.findById(userId).select('telegram').lean();
  const telegram = (user as { telegram?: { chatId?: string; username?: string; linkedAt?: Date } } | null)?.telegram;
  return {
    connected: Boolean(telegram?.chatId),
    username: telegram?.username || '',
    linkedAt: telegram?.linkedAt ? new Date(telegram.linkedAt).toISOString() : null,
  };
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        'telegram.chatId': '',
        'telegram.username': '',
        'telegram.linkCode': '',
        'telegram.linkCodeExpiresAt': null,
        'telegram.linkedAt': null,
      },
    }
  );
}

export async function sendChatMessageToTelegram(recipientUserId: string, payload: { chatId: string; senderName: string; text: string }): Promise<void> {
  if (!hasTelegramConfigured()) return;
  const user = await User.findById(recipientUserId).select('telegram.chatId').lean();
  const chatId = ((user as { telegram?: { chatId?: string } } | null)?.telegram?.chatId || '').trim();
  if (!chatId) return;

  const text = [
    `New message from ${payload.senderName}`,
    '',
    payload.text || '(empty message)',
  ].join('\n');

  const sent = await sendTelegramText(chatId, text.slice(0, 3900));
  const messageId = sent?.result?.message_id;
  if (messageId) {
    await TelegramMessageLink.create({
      userId: recipientUserId,
      telegramChatId: chatId,
      telegramMessageId: messageId,
      appChatId: payload.chatId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }).catch(() => {});
  }
}

export async function isUserInChat(chatId: string, userId: string): Promise<boolean> {
  const chat = await Chat.findById(chatId)
    .populate('studentId', 'userId')
    .populate('universityId', 'userId')
    .lean();
  if (!chat) return false;
  const studentUserId = String(((chat as { studentId?: { userId?: unknown } }).studentId?.userId || ''));
  const universityUserId = String(((chat as { universityId?: { userId?: unknown } }).universityId?.userId || ''));
  return [studentUserId, universityUserId].includes(String(userId));
=======
import { config } from '../config';
import { AppError, ErrorCodes } from '../utils/errors';

type TelegramParseMode = 'Markdown' | 'MarkdownV2' | 'HTML';

type TelegramKeyboardButton = {
  text: string;
  request_contact?: boolean;
};

type TelegramReplyKeyboard = {
  keyboard: TelegramKeyboardButton[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
};

async function callTelegram(method: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = config.telegram.botToken.trim();
  if (!token) {
    throw new AppError(500, 'Telegram bot is not configured', ErrorCodes.INTERNAL_ERROR);
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new AppError(502, `Telegram API error: ${response.status} ${body}`, ErrorCodes.SERVICE_UNAVAILABLE);
  }
  const data = (await response.json()) as { ok?: boolean; description?: string; result?: Record<string, unknown> };
  if (!data.ok) {
    throw new AppError(502, data.description || 'Telegram API rejected request', ErrorCodes.SERVICE_UNAVAILABLE);
  }
  return data.result ?? {};
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  parseMode?: TelegramParseMode,
  replyMarkup?: TelegramReplyKeyboard
): Promise<void> {
  const normalizedChatId = String(chatId ?? '').trim();
  if (!normalizedChatId) {
    throw new AppError(400, 'Telegram chat id is required', ErrorCodes.VALIDATION);
  }

  const messageText = String(text ?? '').trim();
  if (!messageText) {
    throw new AppError(400, 'Telegram text is required', ErrorCodes.VALIDATION);
  }

  const payload: Record<string, unknown> = {
    chat_id: normalizedChatId,
    text: messageText,
  };
  if (parseMode) payload.parse_mode = parseMode;
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  await callTelegram('sendMessage', payload);
}

export async function sendTelegramKeyboard(chatId: string, text: string, keyboard: TelegramKeyboardButton[][]): Promise<void> {
  await sendTelegramMessage(chatId, text, undefined, {
    keyboard,
    resize_keyboard: true,
  });
}

export async function removeTelegramKeyboard(chatId: string, text: string): Promise<void> {
  await callTelegram('sendMessage', {
    chat_id: String(chatId),
    text,
    reply_markup: { remove_keyboard: true },
  });
>>>>>>> Stashed changes
}
