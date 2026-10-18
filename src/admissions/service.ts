import { createHash } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { hostname } from 'os';
import { AdmissionBooking, AdmissionEvent, AdmissionJob, AdmissionKnowledge, AdmissionLead, AdmissionMessage, AdmissionSlot, AdmissionState } from './models';
import { answerQuestion, settings } from './assistant';
import { canFollowUp, copy, detectLanguage, formatSlot, Language, scoreLead } from './policy';
import { markMilestone, trackingStartedAt } from './analytics';

const incomingContext = new AsyncLocalStorage<{ updateId: number; inboundAt: Date }>();

export async function telegram(method: string, body: Record<string, unknown> = {}, token = process.env.ADMISSIONS_TELEGRAM_TOKEN): Promise<any> {
  if (!token) throw new Error('BOT_NOT_CONFIGURED');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(method === 'getUpdates' ? 40000 : 15000) });
  const data: any = await response.json();
  if (!response.ok || !data.ok) throw new Error(`TELEGRAM_${data.error_code || response.status}`);
  return data.result;
}
export async function recordEvent(kind: string, leadId?: any, detail: any = {}, actor?: string) {
  return AdmissionEvent.create({ kind, leadId, detail, actor });
}
export async function staffAlert(kind: string, lead: any, text: string) {
  await recordEvent(kind, lead?._id, { text: text.slice(0, 3000) });
  const cfg = await settings();
  if (!cfg.staffChatId) return;
  const key = `staff:${kind}:${lead?._id || 'system'}:${createHash('sha256').update(text).digest('hex').slice(0, 12)}:${Math.floor(Date.now() / 3600000)}`;
  await AdmissionJob.updateOne({ dedupeKey: key }, { $setOnInsert: { kind: 'staff', due: new Date(), text: `${kind}\n${lead?.name || ''}\n${text.slice(0, 2500)}`, leadId: lead?._id } }, { upsert: true });
}
export async function sendLead(lead: any, text: string, options: Record<string, unknown> = {}, direction = 'out', metadata: any = {}) {
  const deliveryKey = metadata.jobId ? `job:${metadata.jobId}` : undefined;
  let draft: any = deliveryKey ? await AdmissionMessage.findOne({ deliveryKey }) : null;
  if (draft?.delivered) return { message_id: draft.telegramMessageId };
  const context = incomingContext.getStore();
  if (!draft) draft = await AdmissionMessage.create({ leadId: lead._id, direction, text, delivered: false, replyToUpdateId: context?.updateId, inboundAt: context?.inboundAt, analyticsVersion: 1, ...metadata, deliveryKey, deliveryOptions: options, nextAttemptAt: new Date(), lockedUntil: new Date(Date.now() + 45000) });
  try {
    return await deliverDraft(draft, lead, options);
  } catch (error) {
    if (metadata.jobId) throw error; // The durable job owns retries for this message.
    return { queued: true }; // Ordinary replies have their own durable outbox retry.
  }
}
async function deliverDraft(draft: any, lead: any, options?: Record<string, unknown>) {
  draft.deliveryAttempts = (draft.deliveryAttempts || 0) + 1;
  draft.lockedUntil = new Date(Date.now() + 45000); await draft.save();
  try {
    const result = await telegram('sendMessage', { chat_id: lead.chatId, text: draft.text.slice(0, 4000), ...(options || draft.deliveryOptions || {}) });
    draft.delivered = true; draft.telegramMessageId = result.message_id; draft.sentAt = new Date(); draft.errorCode = undefined; draft.lockedUntil = null; await draft.save();
    if (draft.replyToUpdateId != null && draft.inquiryOutcome) await AdmissionMessage.updateOne({ leadId: lead._id, direction: 'in', updateId: draft.replyToUpdateId }, { $set: { inquiryOutcome: draft.inquiryOutcome, answeredAt: draft.sentAt } });
    return result;
  } catch (error) {
    draft.errorCode = error instanceof Error ? error.message.slice(0, 60) : 'SEND_FAILED'; draft.lockedUntil = null;
    draft.nextAttemptAt = new Date(Date.now() + draft.deliveryAttempts * 60000); await draft.save();
    if (draft.deliveryAttempts >= 3) await recordEvent('delivery_failed', lead._id, { messageId: draft._id, code: draft.errorCode });
    throw error;
  }
}
export async function retryOutbox() {
  for (let i = 0; i < 20; i++) {
    const draft: any = await AdmissionMessage.findOneAndUpdate({ delivered: false, cancelled: { $ne: true }, direction: { $in: ['out', 'staff'] }, jobId: null, deliveryAttempts: { $lt: 3 }, nextAttemptAt: { $lte: new Date() }, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: new Date() } }] }, { $set: { lockedUntil: new Date(Date.now() + 45000) } }, { new: true });
    if (!draft) break;
    const lead = await AdmissionLead.findById(draft.leadId);
    if (!lead) { await AdmissionMessage.deleteOne({ _id: draft._id }); continue; }
    if (lead.aiPaused && draft.provider) { draft.cancelled = true; await draft.save(); continue; }
    await deliverDraft(draft, lead).catch(() => {});
  }
}
export async function createSlot(input: any) {
  const start = new Date(input.start); const end = new Date(input.end);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || +start <= Date.now() || +end <= +start || +end - +start > 4 * 3600000) throw new Error('INVALID_SLOT_TIME');
  // Serialize scheduling per consultant with a DB lease, including across multiple workers.
  const key = `calendar-lock:${input.consultantId}`;
  await AdmissionState.updateOne({ key }, { $setOnInsert: { value: { until: new Date(0) } } }, { upsert: true });
  const lease = await AdmissionState.findOneAndUpdate({ key, 'value.until': { $lte: new Date() } }, { $set: { 'value.until': new Date(Date.now() + 15000) } }, { new: true });
  if (!lease) throw new Error('CALENDAR_BUSY');
  try {
    if (await AdmissionSlot.exists({ consultantId: input.consultantId, cancelled: false, start: { $lt: end }, end: { $gt: start } })) throw new Error('SLOT_OVERLAP');
    return await AdmissionSlot.create({ ...input, start, end });
  } finally { await AdmissionState.updateOne({ key }, { $set: { 'value.until': new Date(0) } }); }
}
export async function scheduleReminders(slot: any, lead: any) {
  for (const hours of [24, 6, 2, 1]) {
    const due = new Date(+new Date(slot.start) - hours * 3600000);
    if (+due <= Date.now()) continue;
    await AdmissionJob.updateOne({ dedupeKey: `reminder:${slot._id}:${+new Date(slot.confirmedAt)}:${hours}` }, { $setOnInsert: { kind: 'reminder', leadId: lead._id, slotId: slot._id, bookingId: slot.bookingId, due, originalDue: due, analyticsVersion: 1 } }, { upsert: true });
  }
}
export async function bookSlot(slotId: string, lead: any) {
  const slot: any = await AdmissionSlot.findOneAndUpdate({ _id: slotId, leadId: null, cancelled: false, start: { $gt: new Date() } }, { $set: { leadId: lead._id, confirmedAt: new Date() } }, { new: true });
  if (!slot) throw new Error('SLOT_UNAVAILABLE');
  const booking = await AdmissionBooking.create({ reservationKey: `${slot._id}:${+new Date(slot.confirmedAt)}`, slotId: slot._id, leadId: lead._id, consultantId: slot.consultantId, start: slot.start, end: slot.end, bookedAt: slot.confirmedAt });
  slot.bookingId = booking._id; slot.attendance = 'pending'; await slot.save();
  await scheduleReminders(slot, lead);
  lead.status = 'consultation_booked'; lead.workflow = {}; await lead.save();
  await markMilestone(lead, 'consultation_booked', slot.confirmedAt);
  await staffAlert('booking_created', lead, formatSlot(slot, lead.language));
  return slot;
}
export async function cancelBooking(slotId: string, lead: any, actor = 'student') {
  const slot: any = await AdmissionSlot.findOneAndUpdate({ _id: slotId, leadId: lead._id, cancelled: false, start: { $gt: new Date() } }, { $set: { leadId: null, confirmedAt: null, bookingId: null, attendance: 'pending' } });
  if (!slot) throw new Error('BOOKING_NOT_FOUND');
  const reservationFilter = slot.bookingId ? { bookingId: slot.bookingId } : { leadId: lead._id, bookingId: null };
  if (slot.bookingId) await AdmissionBooking.updateOne({ _id: slot.bookingId, leadId: lead._id, status: 'active' }, { $set: { status: 'cancelled', cancelledAt: new Date() } });
  await AdmissionJob.updateMany({ slotId, ...reservationFilter, kind: 'reminder', status: { $in: ['pending', 'sending'] } }, { $set: { status: 'cancelled' } });
  await AdmissionMessage.updateMany({ slotId, leadId: lead._id, delivered: false }, { $set: { cancelled: true } });
  await recordEvent('booking_cancelled', lead._id, { slotId }, actor);
  await staffAlert('booking_cancelled', lead, formatSlot(slot, lead.language));
  lead.status = 'qualified'; await lead.save(); return slot;
}
export async function showSlots(lead: any) {
  const slots: any[] = await AdmissionSlot.find({ leadId: null, cancelled: false, start: { $gte: new Date() } }).sort({ start: 1 }).limit(12).lean();
  if (!slots.length) return sendLead(lead, copy[lead.language as Language].noSlots);
  const buttons = slots.map(slot => [{ text: formatSlot(slot, lead.language).split('\n')[0].slice(0, 60), callback_data: `book:${slot._id}` }]);
  return sendLead(lead, copy[lead.language as Language].choose, { reply_markup: { inline_keyboard: buttons } });
}
export async function deleteLeadData(lead: any) {
  // Keep a non-reversible suppression receipt for inbound dedupe, not a student profile.
  const receipts: any[] = await AdmissionMessage.find({ leadId: lead._id, updateId: { $exists: true } }).select('updateId').lean();
  const largest = receipts.reduce((max, m) => Math.max(max, m.updateId || 0), 0);
  const hash = createHash('sha256').update(String(lead.chatId)).digest('hex');
  await AdmissionState.updateOne({ key: `deleted:${hash}` }, { $set: { value: { lastUpdate: largest } } }, { upsert: true });
  await Promise.all([
    AdmissionMessage.deleteMany({ leadId: lead._id }), AdmissionJob.deleteMany({ leadId: lead._id }),
    AdmissionEvent.deleteMany({ leadId: lead._id }), AdmissionSlot.updateMany({ leadId: lead._id }, { $set: { leadId: null, confirmedAt: null } }),
    AdmissionBooking.deleteMany({ leadId: lead._id }),
  ]);
  await AdmissionLead.deleteOne({ _id: lead._id });
}
export async function scheduleFollowup(lead: any, input: { due: Date; text: string }, actor: string) {
  if (!lead.followupConsent || lead.aiPaused || ['not_interested', 'closed', 'on_hold', 'enrolled'].includes(lead.status)) throw new Error('FOLLOWUP_NOT_PERMITTED');
  if (+input.due < Date.now() + 60000) throw new Error('INVALID_FOLLOWUP_DATE');
  const job = await AdmissionJob.create({ leadId: lead._id, kind: 'followup', dedupeKey: `followup:${lead._id}:${+input.due}`, due: input.due, originalDue: input.due, analyticsVersion: 1, text: input.text, inboundVersion: lead.lastInboundAt });
  await recordEvent('followup_scheduled', lead._id, { jobId: job._id }, actor); return job;
}
export async function maybeScheduleFollowup(lead: any, cfg: any) {
  if (!cfg.followups || !canFollowUp(lead, { inboundVersion: lead.lastInboundAt })) return;
  const trigger = lead.objections?.includes('parents') ? 'parents' : lead.objections?.includes('considering') ? 'considering' : lead.status === 'consultation_completed' ? 'consultation_completed' : null;
  if (!trigger || await AdmissionJob.exists({ leadId: lead._id, kind: 'followup', status: { $in: ['pending', 'sending'] } })) return;
  // Cap automatic outreach, even across restarts or repeated conversations.
  if (await AdmissionJob.countDocuments({ leadId: lead._id, kind: 'followup', status: 'sent', sentAt: { $gte: new Date(Date.now() - 30 * 86400000) } }) >= 3) return;
  const days = cfg.followupDays?.[trigger] || 3;
  const lang = lead.language as Language;
  const template = cfg.followupTemplates?.[lang]; if (!template) return;
  const text = template.replace(/\{name\}/g, String(lead.name || '').slice(0, 120)).replace(/\{program\}/g, lead.profile?.program ? ` (${String(lead.profile.program).slice(0, 150)})` : '');
  await scheduleFollowup(lead, { due: new Date(Date.now() + days * 86400000), text }, 'automation');
}
export function processUpdate(update: any) {
  return incomingContext.run({ updateId: update.update_id, inboundAt: new Date() }, () => processUpdateInternal(update));
}
async function processUpdateInternal(update: any) {
  const cfg = await settings();
  if (!cfg.enabled) return;
  await trackingStartedAt();
  const message = update.message || update.callback_query?.message;
  const sender = update.message?.from || update.callback_query?.from;
  if (!message || !sender || sender.is_bot || message.chat?.type !== 'private') return;
  const chatId = String(message.chat.id);
  if (await AdmissionMessage.exists({ updateId: update.update_id })) return;
  const deleted: any = await AdmissionState.findOne({ key: `deleted:${createHash('sha256').update(chatId).digest('hex')}` }).lean();
  if (deleted?.value?.lastUpdate >= update.update_id) return;
  const text = String(update.message?.text || (update.message?.contact ? `+${update.message.contact.phone_number.replace(/^\+/, '')}` : update.callback_query?.data || (update.message?.document ? '[Document received: staff review requested]' : '[Unsupported message]'))).trim().slice(0, 8000);
  const lead: any = await AdmissionLead.findOneAndUpdate({ chatId }, { $setOnInsert: { chatId, username: sender.username, name: [sender.first_name, sender.last_name].filter(Boolean).join(' '), analyticsVersion: 1, milestones: { new: new Date() }, language: detectLanguage(text, sender.language_code === 'ru' ? 'ru' : sender.language_code === 'uz' ? 'uz' : 'en') } }, { upsert: true, new: true });
  const started = Date.now();
  const isInquiry = !update.callback_query && !text.startsWith('/') && !lead.workflow?.step && !update.message?.document;
  try { await AdmissionMessage.create({ leadId: lead._id, direction: 'in', text, updateId: update.update_id, telegramMessageId: message.message_id, isInquiry, inquiryOutcome: isInquiry ? 'pending' : undefined, analyticsVersion: 1 }); }
  catch (error: any) { if (error?.code === 11000) return; throw error; }
  lead.lastInboundAt = new Date(); lead.language = detectLanguage(text, lead.language);
  if (isInquiry) {
    const latest: any = await AdmissionJob.findOne({ leadId: lead._id, kind: 'followup', status: 'sent', analyticsVersion: 1, sentAt: { $gte: new Date(Date.now() - 7 * 86400000), $lte: lead.lastInboundAt } }).sort({ sentAt: -1 }).lean();
    const followedUp = latest && !latest.respondedAt ? await AdmissionJob.findOneAndUpdate({ _id: latest._id, respondedAt: null }, { $set: { respondedAt: lead.lastInboundAt, responseUpdateId: update.update_id } }, { new: true }) : null;
    if (followedUp) await recordEvent('followup_response', lead._id, { jobId: followedUp._id });
  }
  await AdmissionJob.updateMany({ leadId: lead._id, kind: 'followup', status: { $in: ['pending', 'sending'] } }, { $set: { status: 'cancelled' } });
  await lead.save();
  if (update.callback_query) await telegram('answerCallbackQuery', { callback_query_id: update.callback_query.id }).catch(() => {});
  const lang = lead.language as Language; const c = copy[lang];
  if (/^(?:helpful|human):\d+$/.test(text)) {
    const originalUpdate = Number(text.split(':')[1]);
    const original = await AdmissionMessage.findOne({ leadId: lead._id, direction: 'in', updateId: originalUpdate, inquiryOutcome: { $in: ['ai_answered', 'ai_resolved', 'unanswered'] } });
    if (!original) return;
    if (text.startsWith('helpful:')) {
      if (original.inquiryOutcome === 'unanswered') return;
      original.inquiryOutcome = 'ai_resolved'; original.feedbackAt = new Date(); await original.save();
      await sendLead(lead, lang === 'ru' ? 'Спасибо за отзыв!' : lang === 'uz' ? 'Fikringiz uchun rahmat!' : 'Thank you for your feedback!'); return;
    }
    original.inquiryOutcome = 'handover'; original.feedbackAt = new Date(); await original.save();
    lead.aiPaused = true; await lead.save(); await staffAlert('handover_requested', lead, lead.summary || original.text); await sendLead(lead, c.human); return;
  }
  if (/^\/delete\b/.test(text)) { await telegram('sendMessage', { chat_id: chatId, text: c.deleted }); await deleteLeadData(lead); return; }
  if (/^\/privacy\b/.test(text)) { await sendLead(lead, c.privacy); return; }
  if (/^\/external_ai\b/.test(text)) {
    lead.externalAIConsent = true; await lead.save();
    await sendLead(lead, lang === 'ru' ? 'Вы разрешили передавать текст этого диалога в Meta для ответов ИИ, если этот провайдер включён администратором. Отозвать разрешение: /local_ai.' : lang === 'uz' ? 'AI javoblari uchun suhbat matnini Meta xizmatiga yuborishga ruxsat berdingiz (agar administrator yoqqan bo‘lsa). Bekor qilish: /local_ai.' : 'You allowed conversation text to be sent to Meta for AI answers when enabled by staff. Revoke with /local_ai.'); return;
  }
  if (/^\/local_ai\b/.test(text)) {
    lead.externalAIConsent = false; await lead.save();
    await sendLead(lead, lang === 'ru' ? 'Для вашего диалога используется только локальный ИИ.' : lang === 'uz' ? 'Suhbatingiz uchun faqat mahalliy AI ishlatiladi.' : 'Your conversation will use local AI only.'); return;
  }
  if (/^\/stop\b/.test(text)) { lead.followupConsent = false; await lead.save(); await sendLead(lead, c.stopped); return; }
  if (/^\/followups\b/.test(text)) { lead.followupConsent = true; await lead.save(); await sendLead(lead, c.consent); return; }
  if (/^\/human\b/.test(text) || /(?:speak|talk).*(?:human|person)|жив.*консульт|позовите.*человека|operator kerak/i.test(text)) {
    await AdmissionMessage.updateOne({ leadId: lead._id, direction: 'in', updateId: update.update_id }, { $set: { inquiryOutcome: 'handover' } });
    lead.aiPaused = true; await lead.save(); await staffAlert('handover_requested', lead, lead.summary || text); await sendLead(lead, c.human); return;
  }
  if (/^\/resume\b/.test(text)) { lead.aiPaused = false; await lead.save(); await sendLead(lead, c.resumed); return; }
  if (/^\/start\b|^\/(?:ru|uz|en)\b/.test(text)) { await sendLead(lead, c.welcome, { reply_markup: { keyboard: [['/book', '/human'], ['/privacy', '/followups']], resize_keyboard: true } }); return; }
  if (update.message?.document) { await staffAlert('document_submitted', lead, 'Student sent a document; review it in the original Telegram chat. Files are not forwarded to AI.'); await sendLead(lead, c.paused); return; }
  if (lead.aiPaused) { await AdmissionMessage.updateOne({ leadId: lead._id, direction: 'in', updateId: update.update_id }, { $set: { inquiryOutcome: 'staff_waiting' } }); await recordEvent('handover_message', lead._id); await sendLead(lead, c.paused); return; }
  if (text.startsWith('cancel:')) {
    const id = text.slice(7); if (!/^[a-f\d]{24}$/i.test(id)) return;
    try { await cancelBooking(id, lead); await sendLead(lead, c.cancelled); } catch { await sendLead(lead, c.unavailable); } return;
  }
  if (text.startsWith('confirm:')) {
    const slot = await AdmissionSlot.findOne({ _id: text.slice(8), leadId: lead._id, cancelled: false });
    if (slot) { await recordEvent('attendance_confirmed', lead._id, { slotId: slot._id }); await sendLead(lead, `${c.booked}\n${formatSlot(slot, lang)}`); } return;
  }
  if (text.startsWith('book:') && cfg.bookings) {
    const id = text.slice(5); if (!/^[a-f\d]{24}$/i.test(id) || !lead.phone || !lead.workflow?.purpose) { await sendLead(lead, c.bookName); lead.workflow = { step: 'name' }; await lead.save(); return; }
    try {
      const previous = Array.isArray(lead.workflow?.rescheduleIds) ? lead.workflow.rescheduleIds : [];
      const slot = await bookSlot(id, lead);
      for (const oldId of previous) { if (String(oldId) !== id) await cancelBooking(String(oldId), lead).catch(() => {}); }
      lead.status = 'consultation_booked'; await lead.save();
      await sendLead(lead, `${c.booked}\n${formatSlot(slot, lang)}\n/reschedule`, { reply_markup: { inline_keyboard: [[{ text: '/cancel', callback_data: `cancel:${slot._id}` }]] } }, 'out', { slotId: slot._id });
    }
    catch { await sendLead(lead, c.unavailable); } return;
  }
  if (/^\/cancel\b/.test(text)) { lead.workflow = {}; await lead.save(); const slots: any[] = await AdmissionSlot.find({ leadId: lead._id, cancelled: false, start: { $gt: new Date() } }).lean(); for (const slot of slots) await cancelBooking(String(slot._id), lead); await sendLead(lead, c.cancelled); return; }
  if (/^\/(?:book|reschedule)\b/.test(text) && cfg.bookings) {
    const previous = text.startsWith('/reschedule') ? await AdmissionSlot.find({ leadId: lead._id, cancelled: false, start: { $gt: new Date() } }).select('_id').lean() : [];
    // Preserve the old appointment until the replacement is successfully reserved.
    lead.workflow = { step: 'name', rescheduleIds: previous.map(s => String(s._id)) }; await lead.save(); await sendLead(lead, c.bookName); return;
  }
  if (cfg.bookings && lead.workflow?.step) {
    const workflow = { ...lead.workflow };
    if (workflow.step === 'name') { if (text.length < 2 || text.length > 120) { await sendLead(lead, c.bookName); return; } lead.name = text; workflow.step = 'phone'; lead.workflow = workflow; await lead.save(); await sendLead(lead, c.bookPhone, { reply_markup: { keyboard: [[{ text: 'Share phone', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } }); return; }
    if (workflow.step === 'phone') { if (!/^\+?[0-9()\s-]{7,22}$/.test(text)) { await sendLead(lead, c.bookPhone); return; } lead.phone = text; workflow.step = 'purpose'; lead.workflow = workflow; await lead.save(); await sendLead(lead, c.bookPurpose, { reply_markup: { remove_keyboard: true } }); return; }
    if (workflow.step === 'purpose') { workflow.purpose = text.slice(0, 500); delete workflow.step; lead.workflow = workflow; lead.profile = { ...lead.profile, consultationPurpose: workflow.purpose }; await lead.save(); await showSlots(lead); return; }
  }
  if (!cfg.autoReplies) { await recordEvent('automation_paused', lead._id); return; }
  const history = (await AdmissionMessage.find({ leadId: lead._id, updateId: { $ne: update.update_id } }).sort({ createdAt: -1 }).limit(12).lean()).reverse();
  const originalScore = lead.score;
  const analysis = scoreLead(text, lead.profile); Object.assign(lead, analysis);
  if (analysis.intent === 'career_guidance') { await lead.save(); await sendLead(lead, c.career); return; }
  const answer = await answerQuestion(text, lead, history);
  const currentAutomation: any = await AdmissionLead.findById(lead._id).select('aiPaused').lean();
  if (!currentAutomation || currentAutomation.aiPaused) {
    await AdmissionMessage.updateOne({ leadId: lead._id, direction: 'in', updateId: update.update_id }, { $set: { inquiryOutcome: 'staff_waiting' } });
    await recordEvent('ai_suppressed_on_takeover', lead._id); return;
  }
  const extractedProfile: Record<string, string> = answer.profile;
  lead.profile = { ...lead.profile, ...extractedProfile }; if (extractedProfile.name) lead.name = extractedProfile.name;
  if (extractedProfile.phone && /^\+?[0-9()\s-]{7,22}$/.test(extractedProfile.phone)) lead.phone = extractedProfile.phone;
  if (answer.summary) lead.summary = answer.summary;
  Object.assign(lead, scoreLead(text, lead.profile));
  if (lead.status === 'new' && Object.keys(lead.profile).length >= 3) lead.status = 'qualified';
  await lead.save();
  if (lead.status === 'qualified') await markMilestone(lead, 'qualified');
  if (answer.needsHuman) await staffAlert('unanswered_question', lead, text);
  if (answer.errorCode) await recordEvent('ai_error', lead._id, { code: answer.errorCode });
  if (lead.score >= 60 && originalScore < 60) await staffAlert('high_priority', lead, lead.summary || text);
  const buttons = [{ text: lang === 'ru' ? 'Консультант' : lang === 'uz' ? 'Maslahatchi' : 'Ask a consultant', callback_data: `human:${update.update_id}` }];
  if (!answer.needsHuman) buttons.unshift({ text: lang === 'ru' ? 'Помогло ✓' : lang === 'uz' ? 'Foydali ✓' : 'Helpful ✓', callback_data: `helpful:${update.update_id}` });
  await sendLead(lead, answer.reply, { reply_markup: { inline_keyboard: [buttons] } }, 'out', { provider: answer.provider, sourceIds: answer.sourceIds, responseMs: Date.now() - started, inquiryOutcome: answer.needsHuman ? 'unanswered' : 'ai_answered' });
  await maybeScheduleFollowup(lead, cfg);
}

let running = false; let tickBusy = false;
export async function runDueJobs() {
  if (tickBusy) return; tickBusy = true;
  try {
    const cfg = await settings(); if (!cfg.enabled) return;
    await retryOutbox();
    for (let count = 0; count < 30; count++) {
      const now = new Date();
      const job: any = await AdmissionJob.findOneAndUpdate({ due: { $lte: now }, attempts: { $lt: 3 }, $or: [{ status: 'pending' }, { status: 'sending', lockedUntil: { $lt: now } }] }, { $set: { status: 'sending', lockedUntil: new Date(Date.now() + 90000) }, $inc: { attempts: 1 } }, { sort: { due: 1 }, new: true });
      if (!job) break;
      try {
        if (job.kind === 'staff') {
          if (!cfg.staffChatId) { job.status = 'cancelled'; await job.save(); continue; }
          await telegram('sendMessage', { chat_id: cfg.staffChatId, text: job.text });
        } else {
          const lead: any = await AdmissionLead.findById(job.leadId);
          if (!lead || (job.kind === 'followup' && (!cfg.followups || !canFollowUp(lead, job)))) { job.status = 'cancelled'; await job.save(); continue; }
          let text = job.text;
          let options = {};
          if (job.kind === 'reminder') {
            const slot: any = await AdmissionSlot.findOne({ _id: job.slotId, leadId: lead._id, ...(job.bookingId ? { bookingId: job.bookingId } : {}), cancelled: false, start: { $gt: new Date() } }).lean();
            if (!cfg.reminders || !slot) { job.status = 'cancelled'; await job.save(); continue; }
            text = `${copy[lead.language as Language].booked}\n${formatSlot(slot, lead.language)}`;
            options = { reply_markup: { inline_keyboard: [[{ text: 'Confirm', callback_data: `confirm:${slot._id}` }, { text: 'Cancel / Reschedule', callback_data: `cancel:${slot._id}` }]] } };
          }
          await sendLead(lead, text, options, 'out', { jobId: String(job._id), slotId: job.slotId });
        }
        job.status = 'sent'; job.sentAt = new Date();
      } catch (error) {
        job.errorCode = error instanceof Error ? error.message.slice(0, 60) : 'DELIVERY_FAILED';
        job.status = job.attempts >= 3 ? 'failed' : 'pending'; job.due = new Date(Date.now() + job.attempts * 60000);
        if (job.status === 'failed') await recordEvent('delivery_failed', job.leadId, { jobId: job._id, code: job.errorCode });
      }
      await job.save();
    }
  } finally { tickBusy = false; }
}
export function startAdmissionsAssistant() {
  if (running || !process.env.ADMISSIONS_TELEGRAM_TOKEN) return;
  if (process.env.ADMISSIONS_TELEGRAM_TOKEN === process.env.TELEGRAM_BOT_TOKEN) throw new Error('ADMISSIONS_BOT_MUST_BE_SEPARATE');
  running = true;
  const interval = setInterval(() => { runDueJobs().catch(() => {}); }, 20000); interval.unref();
  void (async () => {
    for (const model of [AdmissionLead, AdmissionMessage, AdmissionKnowledge, AdmissionSlot, AdmissionBooking, AdmissionJob, AdmissionState]) await model.init();
    await trackingStartedAt();
    await telegram('setMyCommands', { commands: [ { command: 'start', description: 'Edmission AI assistant' }, { command: 'book', description: 'Book a consultation' }, { command: 'reschedule', description: 'Change consultation time' }, { command: 'human', description: 'Contact a consultant' }, { command: 'resume', description: 'Resume AI support' }, { command: 'followups', description: 'Allow follow-up messages' }, { command: 'stop', description: 'Stop follow-up messages' }, { command: 'privacy', description: 'Privacy information' }, { command: 'delete', description: 'Delete my conversation data' }, { command: 'ru', description: 'Русский' }, { command: 'uz', description: 'O‘zbekcha' }, { command: 'en', description: 'English' } ] }).catch(() => {});
    let delay = 1000;
    while (running) {
      try {
        const cfg = await settings(); if (!cfg.enabled) { await new Promise(r => setTimeout(r, 10000)); continue; }
        // DB lease prevents two PM2 instances consuming the same bot update queue.
        const owner = `${hostname()}:${process.pid}`;
        await AdmissionState.updateOne({ key: 'poller-lease' }, { $setOnInsert: { value: { until: new Date(0) } } }, { upsert: true });
        const previous: any = await AdmissionState.findOne({ key: 'poller-lease' }).lean();
        const localPrefix = `${hostname()}:`;
        if (previous?.value?.owner?.startsWith(localPrefix) && previous.value.owner !== owner) {
          const previousPid = Number(previous.value.owner.slice(localPrefix.length));
          if (Number.isInteger(previousPid) && previousPid > 0) {
            try { process.kill(previousPid, 0); }
            catch (error: any) { if (error.code === 'ESRCH') await AdmissionState.updateOne({ key: 'poller-lease', 'value.owner': previous.value.owner }, { $set: { 'value.until': new Date(0) } }); }
          }
        }
        const lease = await AdmissionState.findOneAndUpdate({ key: 'poller-lease', $or: [{ 'value.owner': owner }, { 'value.until': { $lt: new Date() } }] }, { $set: { 'value.owner': owner, 'value.until': new Date(Date.now() + 120000) } }, { new: true });
        if (!lease) { await new Promise(r => setTimeout(r, 15000)); continue; }
        const state: any = await AdmissionState.findOne({ key: 'telegram-offset' }).lean();
        const updates = await telegram('getUpdates', { offset: state?.value?.offset || 0, timeout: 25, limit: 10, allowed_updates: ['message', 'callback_query'] });
        for (const update of updates) {
          try { await processUpdate(update); }
          catch (error) { await recordEvent('update_failed', undefined, { updateId: update.update_id, code: error instanceof Error ? error.message.replace(/[^A-Z0-9_]/gi, '').slice(0, 60) : 'PROCESS_FAILED' }); }
          await AdmissionState.updateOne({ key: 'telegram-offset' }, { $set: { value: { offset: update.update_id + 1 } } }, { upsert: true });
          await AdmissionState.updateOne({ key: 'poller-lease', 'value.owner': owner }, { $set: { 'value.until': new Date(Date.now() + 120000) } });
        }
        delay = 1000;
      } catch (error) {
        await recordEvent('polling_error', undefined, { code: error instanceof Error ? error.message.replace(/[^A-Z0-9_]/gi, '').slice(0, 60) : 'POLL_FAILED' }).catch(() => {});
        await new Promise(r => setTimeout(r, delay)); delay = Math.min(delay * 2, 60000);
      }
    }
  })().catch(() => { running = false; });
}
