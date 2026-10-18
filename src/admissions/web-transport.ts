import { AdmissionLead, AdmissionState, AdmissionWebDelivery } from './models';

export const isWebChat = (chatId: unknown) => typeof chatId === 'string' && /^web:[a-f\d]{24}$/i.test(chatId);
export function startWebsiteLeaseHeartbeat(key: string, owner: string, period = 30000, duration = 120000) {
  let pending: Promise<any> | undefined;
  const timer = setInterval(() => {
    if (pending) return;
    pending = AdmissionState.updateOne({ key, 'value.owner': owner }, { $set: { 'value.until': new Date(Date.now() + duration) } }).exec().catch(() => {}).finally(() => { pending = undefined; });
  }, period);
  timer.unref();
  return async () => { clearInterval(timer); if (pending) await pending; };
}
export async function nextWebSequence(): Promise<number> {
  try { await AdmissionState.updateOne({ key: 'website-sequence' }, { $setOnInsert: { value: { counter: 0 } } }, { upsert: true }); }
  catch (error: any) { if (error.code !== 11000) throw error; }
  const state: any = await AdmissionState.findOneAndUpdate({ key: 'website-sequence' }, { $inc: { 'value.counter': 1 } }, { new: true });
  const value = Number(state.value.counter); if (!Number.isSafeInteger(value) || value <= 0) throw Error('WEB_SEQUENCE_EXHAUSTED');
  return -value; // Telegram update/message IDs are nonnegative; website IDs cannot collide.
}
export async function websiteTransport(method: string, body: Record<string, any>, receiptId?: any) {
  const chatId = String(body.chat_id || '');
  if (method === 'answerCallbackQuery' && String(body.callback_query_id).startsWith('web:')) return true;
  if (!isWebChat(chatId)) throw Error('INVALID_WEBSITE_DESTINATION');
  if (method === 'sendChatAction') {
    await AdmissionLead.updateOne({ chatId }, { $set: { webTypingUntil: new Date(Date.now() + (body.action === 'typing' ? 5000 : 0)) } }); return true;
  }
  if (method === 'sendMessage') {
    const existing: any = receiptId ? await AdmissionWebDelivery.findOne({ receiptId, chatId }) : null;
    if (existing) return { message_id: existing.messageId };
    const messageId = await nextWebSequence();
    const delivery = { chatId, messageId, ...(receiptId ? { receiptId } : {}), text: body.text, options: { reply_markup: body.reply_markup } };
    if (receiptId) {
      const row: any = await AdmissionWebDelivery.findOneAndUpdate({ receiptId, chatId }, { $setOnInsert: delivery }, { upsert: true, new: true });
      return { message_id: row.messageId };
    }
    await AdmissionWebDelivery.create(delivery); return { message_id: messageId };
  }
  if (method === 'editMessageText') {
    const row: any = await AdmissionWebDelivery.findOneAndUpdate({ chatId, messageId: body.message_id }, { $set: { text: body.text, options: { reply_markup: body.reply_markup }, editedAt: new Date() } }, { new: true });
    if (!row) { const error: any = Error('WEBSITE_MESSAGE_NOT_FOUND'); error.telegramCode = 400; error.description = 'message to edit not found'; throw error; }
    return { message_id: row.messageId };
  }
  throw Error('UNSUPPORTED_WEBSITE_TRANSPORT');
}
