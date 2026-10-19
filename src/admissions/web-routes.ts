import { Router } from 'express';
import mongoose from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireDb } from '../middlewares/requireDb.middleware';
import { User, StudentProfile } from '../models';
import { AdmissionLead, AdmissionMessage, AdmissionSlot, AdmissionState, AdmissionWebDelivery, AdmissionWebRequest } from './models';
import { processUpdate, sendLead } from './service';
import { askIntake, intakeCopy, normalizePhone } from './onboarding';
import { nextWebSequence, startWebsiteLeaseHeartbeat } from './web-transport';
import { settings } from './assistant';
import { mainMenu } from './menu';

const router = Router();
const wrap = (fn: any) => (req: any, res: any, next: any) => Promise.resolve(fn(req, res)).catch(next);
router.use(authMiddleware, requireDb);
const mutations = rateLimit({ windowMs: 60000, max: 20, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user!.id });
let indexes: Promise<any> | undefined;
async function ready() { if (!indexes) indexes = Promise.all([AdmissionWebDelivery.init(), AdmissionWebRequest.init(), AdmissionLead.init(), AdmissionState.init()]); await indexes; }

async function ownLead(userId: string, requestedLanguage?: string) {
  await ready();
  const user: any = await User.findById(userId).select('name phone language').lean();
  if (!user) throw Object.assign(Error('Account not found'), { statusCode: 401 });
  const student: any = await StudentProfile.findOne({ userId }).select('firstName lastName preferredCountries targetDegreeLevel interestedFaculties interests budgetAmount budgetCurrency languageLevel highestEducationLevel educationStatus').lean();
  const name = String([student?.firstName, student?.lastName].filter(Boolean).join(' ') || user.name || '').trim().slice(0, 120), phone = normalizePhone(user.phone || '');
  const language = ['en', 'ru', 'uz'].includes(requestedLanguage || '') ? requestedLanguage! : ['en', 'ru', 'uz'].includes(user.language) ? user.language : 'uz';
  const profile: Record<string, string> = {};
  const values = { destination: student?.preferredCountries?.join(', '), degree: student?.targetDegreeLevel,
    program: (student?.interestedFaculties?.length ? student.interestedFaculties : student?.interests)?.join(', '),
    budget: student?.budgetAmount != null ? `${student.budgetAmount} ${student.budgetCurrency || 'USD'}` : '',
    english: student?.languageLevel, education: student?.highestEducationLevel || student?.educationStatus };
  for (const [key, value] of Object.entries(values)) if (value) profile[`profile.${key}`] = String(value).slice(0, 300);
  const initial = { chatId: `web:${userId}`, channel: 'website', webUserId: userId, onboardingVersion: 1, onboardedAt: new Date() };
  // Website authentication replaces Telegram intake, even when optional profile fields are empty.
  const synced = { name, phone: phone || '', language, languageExplicit: true, nameConfirmed: true, phoneConfirmed: true,
    onboardingStage: 'complete', ...profile };
  let lead: any;
  try { lead = await AdmissionLead.findOneAndUpdate({ chatId: initial.chatId }, { $setOnInsert: initial, $set: synced }, { upsert: true, new: true }); }
  catch (error: any) { if (error.code !== 11000) throw error; lead = await AdmissionLead.findOneAndUpdate({ chatId: initial.chatId }, { $set: synced }, { new: true }); }
  let claim: any;
  try { claim = await AdmissionState.updateOne({ key: `web-welcome:${lead._id}` }, { $setOnInsert: { value: { initialized: true } } }, { upsert: true }); }
  catch (error: any) { if (error.code !== 11000) throw error; }
  if (claim?.upsertedCount) { await sendLead(lead, intakeCopy[lead.language as 'en'].intro); await askIntake(lead, sendLead); }
  return lead;
}
export async function websiteSession(lead: any, before?: string) {
  const obsoleteIntake = Object.values(intakeCopy).flatMap(c => [c.name, c.phone]);
  obsoleteIntake.push('Введите номер телефона с кодом страны. Продолжая, вы разрешаете обработку диалога Meta AI.',
    'Telefon raqamingizni mamlakat kodi bilan yozing. Davom etsangiz, suhbat Meta AI orqali qayta ishlanadi.',
    'Enter your phone number with its country code. Continuing enables Meta AI for your chat.');
  const rows: any[] = await AdmissionMessage.find({ leadId: lead._id, text: { $nin: obsoleteIntake }, isCallback: { $ne: true }, direction: { $in: ['in', 'out'] },
    $or: [{ direction: 'in' }, { delivered: true }], ...(before ? { _id: { $lt: new mongoose.Types.ObjectId(before) } } : {}) }).sort({ _id: -1 }).limit(101).lean();
  const page = rows.slice(0, 100).reverse();
  const deliveries: any[] = await AdmissionWebDelivery.find({ chatId: lead.chatId, receiptId: { $in: page.map(row => row._id) } }).lean();
  const lock: any = await AdmissionState.findOne({ key: `web-lock:${lead.webUserId}` }).lean();
  const current: any = await AdmissionLead.findById(lead._id).lean();
  if (!current) return { lead: null, language: lead.language, messages: [], typing: false, processing: false, nextCursor: null };
  const hasBookings = Boolean(await AdmissionSlot.exists({ leadId: current._id, cancelled: false, start: { $gt: new Date() } }));
  return { lead: { id: String(current._id), language: current.language, name: current.name || '', phone: current.phone || '', onboardingStage: current.onboardingStage, externalAIConsent: current.externalAIConsent }, language: current.language,
    messages: page.map(row => {
      const delivery = deliveries.find(item => String(item.receiptId) === String(row._id));
      const options = delivery?.options || row.deliveryOptions || {};
      const localizedOptions = options.reply_markup?.keyboard ? { ...options, reply_markup: mainMenu(current.language, false, hasBookings) } : options;
      return { id: row.direction === 'out' ? delivery?.messageId ?? row.telegramMessageId : String(row._id), direction: row.direction, text: delivery?.text ?? row.text, createdAt: row.createdAt, editedAt: delivery?.editedAt || null, options: localizedOptions };
    }),
    typing: +new Date(current.webTypingUntil || 0) > Date.now(), processing: +new Date(lock?.value?.until || 0) > Date.now(), nextCursor: rows.length > 100 && page.length ? String(page[0]._id) : null };
}
router.get('/session', wrap(async (req: any, res: any) => {
  const query = z.object({ before: z.string().regex(/^[a-f\d]{24}$/i).optional() }).parse(req.query);
  res.json(await websiteSession(await ownLead(req.user.id, req.get('X-User-Language')), query.before));
}));

const requestId = z.string().uuid();
const messageSchema = z.object({ text: z.string().trim().min(1).max(4000), requestId }).strict();
const actionSchema = z.object({ data: z.string().min(1).max(100), messageId: z.number().int().safe().negative(), requestId }).strict();
async function submit(req: any, res: any, kind: 'message' | 'action') {
  const input: any = kind === 'message' ? messageSchema.parse(req.body) : actionSchema.parse(req.body);
  const cfg = await settings(); if (!cfg.enabled) { res.status(503).json({ error: 'AI assistant is temporarily disabled' }); return; }
  const lead = await ownLead(req.user.id, req.get('X-User-Language'));
  const payloadHash = createHash('sha256').update(JSON.stringify({ kind, ...input })).digest('hex');
  const prior: any = await AdmissionWebRequest.findOne({ userId: req.user.id, requestId: input.requestId }).lean();
  if (prior) {
    if (prior.payloadHash !== payloadHash) { res.status(409).json({ error: 'Request identifier belongs to different content' }); return; }
    if (prior.status === 'processing') {
      const active: any = await AdmissionState.findOne({ key: `web-lock:${req.user.id}` }).lean();
      if (+new Date(active?.value?.until || 0) <= Date.now()) {
        const completed = await AdmissionMessage.exists({ leadId: lead._id, direction: 'out', replyToUpdateId: prior.updateId, delivered: true });
        prior.status = completed ? 'done' : 'failed';
        await AdmissionWebRequest.updateOne({ _id: prior._id }, { $set: { status: prior.status } });
      }
    }
    if (prior.status === 'failed') { res.status(503).json({ error: 'The previous request could not be completed. Refresh the chat before trying again.' }); return; }
    res.status(prior.status === 'processing' ? 202 : 200).json(await websiteSession(lead)); return;
  }
  let source: any;
  if (kind === 'action') {
    source = await AdmissionWebDelivery.findOne({ chatId: lead.chatId, messageId: input.messageId }).lean();
    const offered = source?.options?.reply_markup?.inline_keyboard?.flat().some((button: any) => button.callback_data === input.data);
    if (!offered) { res.status(400).json({ error: 'This action is no longer available in your chat' }); return; }
  }
  const key = `web-lock:${req.user.id}`, owner = randomUUID();
  try { await AdmissionState.updateOne({ key }, { $setOnInsert: { value: { until: new Date(0) } } }, { upsert: true }); } catch (error: any) { if (error.code !== 11000) throw error; }
  const lock = await AdmissionState.findOneAndUpdate({ key, 'value.until': { $lte: new Date() } }, { $set: { value: { owner, until: new Date(Date.now() + 120000) } } });
  if (!lock) { res.status(409).json({ error: 'A response is already being prepared. Please wait.' }); return; }
  const stopHeartbeat = startWebsiteLeaseHeartbeat(key, owner);
  let request: any;
  try {
    const updateId = await nextWebSequence();
    request = await AdmissionWebRequest.create({ userId: req.user.id, requestId: input.requestId, payloadHash, updateId, status: 'processing' });
    const from = { id: lead.chatId, is_bot: false }, chat = { id: lead.chatId, type: 'private' };
    const update = kind === 'message' ? { update_id: updateId, message: { message_id: updateId, from, chat, text: input.text } }
      : { update_id: updateId, callback_query: { id: `web:${input.requestId}`, from, data: input.data, message: { message_id: source.messageId, chat, from: { is_bot: true }, text: source.text, reply_markup: source.options?.reply_markup } } };
    await processUpdate(update);
    await AdmissionWebRequest.updateOne({ _id: request._id }, { $set: { status: 'done' } });
  } catch (error: any) {
    if (request) await AdmissionWebRequest.updateOne({ _id: request._id }, { $set: { status: 'failed', errorCode: String(error.name || 'WEB_REQUEST_FAILED').slice(0, 60) } });
    throw error;
  } finally { await stopHeartbeat(); await AdmissionState.updateOne({ key, 'value.owner': owner }, { $set: { 'value.until': new Date(0) } }); }
  res.json(await websiteSession(lead));
}
router.post('/messages', mutations, wrap((req: any, res: any) => submit(req, res, 'message')));
router.post('/actions', mutations, wrap((req: any, res: any) => submit(req, res, 'action')));
export default router;
