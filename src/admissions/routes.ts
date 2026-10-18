import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import { execFile } from 'child_process';
import multer from 'multer';
import { z } from 'zod';
import mongoose from 'mongoose';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireAdminOnly, requireRole } from '../middlewares/rbac.middleware';
import { requireDb } from '../middlewares/requireDb.middleware';
import { AdmissionCalendarAnchor, AdmissionBooking, AdmissionEvent, AdmissionJob, AdmissionKnowledge, AdmissionLead, AdmissionMessage, AdmissionSlot, AdmissionState, leadStatuses } from './models';
import { answerQuestion, defaultSettings, settings } from './assistant';
import { cancelBooking, createSlot, deleteLeadData, maybeScheduleFollowup, recordEvent, scheduleFollowup, sendLead, staffAlert, telegram } from './service';
import { admissionAnalytics, markMilestone } from './analytics';
import { importPublicUniversityDrafts } from './public-knowledge';
import { listStaffBookings, listStaffQuestions, staffConversationPage } from './admin-data';

const router = Router();
const asyncRoute = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
router.get('/console', (_req, res) => res.sendFile(path.resolve(__dirname, '../../public/admissions/index.html')));
router.get('/console.js', (_req, res) => res.sendFile(path.resolve(__dirname, '../../public/admissions/console.js')));
router.use(authMiddleware, requireRole('admin', 'manager', 'counsellor_coordinator'), requireDb);
router.param('id', (_req, res, next, id) => { if (!mongoose.isValidObjectId(id)) { res.status(400).json({ error: 'Invalid ID' }); return; } next(); });
router.get('/overview', asyncRoute(async (_req, res) => {
  const [leads, incoming, aiResolved, bookings, handovers, jobs, statuses, average, frequent, cfg] = await Promise.all([
    AdmissionLead.countDocuments(), AdmissionMessage.countDocuments({ direction: 'in' }),
    AdmissionMessage.countDocuments({ direction: 'out', sourceIds: { $exists: true, $ne: [] }, delivered: true }),
    AdmissionSlot.countDocuments({ leadId: { $ne: null }, cancelled: false }),
    AdmissionEvent.countDocuments({ kind: 'handover_requested' }),
    AdmissionJob.aggregate([{ $group: { _id: { kind: '$kind', status: '$status' }, count: { $sum: 1 } } }]),
    AdmissionLead.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    AdmissionMessage.aggregate([{ $match: { responseMs: { $gt: 0 } } }, { $group: { _id: null, responseMs: { $avg: '$responseMs' } } }]),
    AdmissionEvent.aggregate([{ $match: { kind: 'unanswered_question', resolvedAt: null } }, { $group: { _id: '$detail.text', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    settings(),
  ]);
  res.json({ leads, incoming, aiAnsweredMessages: aiResolved, bookings, handovers, jobs, statuses, averageResponseMs: average[0]?.responseMs ?? null, unanswered: frequent,
    integration: { telegramConfigured: Boolean(process.env.ADMISSIONS_TELEGRAM_TOKEN), metaConfigured: Boolean(process.env.LLAMA_API_KEY), provider: cfg.provider, model: cfg.provider === 'ollama' ? process.env.ADMISSIONS_OLLAMA_MODEL || 'qwen3:0.6b' : cfg.model, calendar: 'Built-in consultation calendar', staffTelegramConfigured: Boolean(cfg.staffChatId) } });
}));
router.get('/analytics', asyncRoute(async (req, res) => {
  const query = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }).parse(req.query);
  const to = query.to || new Date(); const from = query.from || new Date(+to - 30 * 86400000);
  if (+from >= +to || +to - +from > 366 * 86400000 || +to > Date.now() + 86400000) { res.status(400).json({ error: 'Choose a valid range of up to 366 days' }); return; }
  res.json(await admissionAnalytics(from, to));
}));
router.get('/settings', asyncRoute(async (_req, res) => { res.json(await settings()); }));
const settingsSchema = z.object({
  enabled: z.boolean(), autoReplies: z.boolean(), bookings: z.boolean(), reminders: z.boolean(), followups: z.boolean(),
  metaWireApi: z.enum(['responses', 'chat/completions']).optional(), reasoningEffort: z.enum(['low','medium','high']).optional(),
  metaEndpoint: z.enum(['https://api.meta.ai/v1', 'https://api.llama.com/v1']).optional(),
  availability: z.object({ enabled: z.boolean(), consultantId: z.string().min(1).max(100), consultantName: z.string().min(1).max(120), startHour: z.number().int().min(0).max(23), lastStartHour: z.number().int().min(0).max(23), monthsAhead: z.number().int().min(1).max(12), weekdays: z.array(z.number().int().min(0).max(6)).max(7), closedDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366), mode: z.enum(['online','office']), location: z.string().min(1).max(500) }).refine(v => v.lastStartHour >= v.startHour).optional(),
  provider: z.enum(['meta', 'ollama']), model: z.string().min(1).max(100).refine(v => !/contributor/i.test(v)),
  staffChatId: z.string().max(30).regex(/^-?\d*$|^@\w+$/), retentionDays: z.number().int().min(30).max(3650), instructions: z.string().max(4000),
  followupDays: z.record(z.string(), z.number().int().min(1).max(90)).optional(),
  followupTemplates: z.object({ en: z.string().min(1).max(2000), ru: z.string().min(1).max(2000), uz: z.string().min(1).max(2000) }).optional(),
});
router.put('/settings', requireAdminOnly, asyncRoute(async (req, res) => {
  const value = { ...(await settings()), ...settingsSchema.parse(req.body) };
  await AdmissionState.updateOne({ key: 'settings' }, { $set: { value } }, { upsert: true });
  await recordEvent('settings_updated', undefined, { enabled: value.enabled, provider: value.provider }, req.user!.id);
  res.json({ ...defaultSettings, ...value });
}));
router.post('/test', asyncRoute(async (req, res) => {
  const input = z.object({ text: z.string().min(1).max(4000), language: z.enum(['uz', 'ru', 'en']), instructions: z.string().max(4000).optional() }).parse(req.body);
  res.json(await answerQuestion(input.text, { language: input.language, externalAIConsent: true }, [], input.instructions ? { instructions: input.instructions } : undefined));
}));
router.post('/integration-test', requireAdminOnly, asyncRoute(async (_req, res) => {
  const bot = await telegram('getMe'); const cfg = await settings();
  res.json({ telegram: true, username: bot.username, provider: cfg.provider, metaConfigured: Boolean(process.env.LLAMA_API_KEY) });
}));
router.get('/leads', asyncRoute(async (req, res) => {
  const query = z.object({ status: z.enum(leadStatuses).optional(), q: z.string().max(100).optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
  const filter: any = {};
  if (query.status) filter.status = query.status;
  if (query.q) { const escaped = query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = ['name', 'username', 'phone'].map(k => ({ [k]: { $regex: escaped, $options: 'i' } })); }
  res.json({ items: await AdmissionLead.find(filter).sort({ updatedAt: -1 }).skip((query.page - 1) * 50).limit(50).lean(), total: await AdmissionLead.countDocuments(filter) });
}));
const staffListQuery = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(50), q: z.string().max(100).default('') });
router.get('/bookings', asyncRoute(async (req, res) => {
  const query = staffListQuery.extend({ status: z.enum(['active', 'cancelled', 'all']).default('all') }).parse(req.query);
  res.json(await listStaffBookings(query.page, query.limit, query.q, query.status));
}));
router.get('/questions', asyncRoute(async (req, res) => {
  const query = staffListQuery.parse(req.query);
  res.json(await listStaffQuestions(query.page, query.limit, query.q));
}));
router.get('/leads/:id/messages', asyncRoute(async (req, res) => {
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: z.string().regex(/^[a-f\d]{24}$/i).optional() }).parse(req.query);
  if (!await AdmissionLead.exists({ _id: req.params.id })) { res.status(404).json({ error: 'Lead not found' }); return; }
  res.json(await staffConversationPage(req.params.id, query.limit, query.before));
}));
router.get('/leads/:id', asyncRoute(async (req, res) => {
  const lead = await AdmissionLead.findById(req.params.id).lean(); if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
  res.json({ lead, calendarMessages: await AdmissionCalendarAnchor.find({ leadId: req.params.id }).sort({ updatedAt: -1 }).limit(20).lean(), messages: (await AdmissionMessage.find({ leadId: req.params.id }).sort({ createdAt: -1 }).limit(150).lean()).reverse(), bookings: await AdmissionSlot.find({ leadId: req.params.id }).sort({ start: -1 }).lean(), jobs: await AdmissionJob.find({ leadId: req.params.id }).sort({ due: -1 }).limit(100).lean(), events: await AdmissionEvent.find({ leadId: req.params.id }).sort({ createdAt: -1 }).limit(100).lean() });
}));
router.patch('/leads/:id', asyncRoute(async (req, res) => {
  const data = z.object({ status: z.enum(leadStatuses).optional(),  assignedTo: z.string().max(100).optional(), notes: z.string().max(10000).optional(), profile: z.record(z.string(), z.string().max(1000)).optional(), name: z.string().max(150).optional(), phone: z.string().max(30).optional() }).parse(req.body);
  const lead = await AdmissionLead.findByIdAndUpdate(req.params.id, { $set: data }, { new: true });
  if (!lead) { res.status(404).json({ error: 'Lead not found' }); return; }
  if (data.status) await markMilestone(lead, data.status);
  if (['not_interested', 'closed', 'on_hold', 'enrolled'].includes(data.status || '')) await AdmissionJob.updateMany({ leadId: lead._id, kind: 'followup', status: 'pending' }, { $set: { status: 'cancelled' } });
  await recordEvent('lead_updated', lead._id, { fields: Object.keys(data) }, req.user!.id); res.json(lead);
}));
router.delete('/leads/:id', requireAdminOnly, asyncRoute(async (req, res) => { const lead = await AdmissionLead.findById(req.params.id); if (!lead) { res.sendStatus(404); return; } await deleteLeadData(lead); res.json({ deleted: true }); }));
router.post('/leads/:id/reply', asyncRoute(async (req, res) => {
  const { text } = z.object({ text: z.string().min(1).max(3500) }).parse(req.body);
  const lead: any = await AdmissionLead.findById(req.params.id); if (!lead) { res.sendStatus(404); return; }
  res.status(409).json({ error: 'Student chat is AI-only; consultant takeover is disabled' });
}));
router.post('/leads/:id/followup', asyncRoute(async (req, res) => {
  const data = z.object({ due: z.coerce.date(), text: z.string().min(1).max(2000) }).parse(req.body);
  const lead = await AdmissionLead.findById(req.params.id); if (!lead) { res.sendStatus(404); return; }
  res.json(await scheduleFollowup(lead, data, req.user!.id));
}));
router.get('/knowledge', asyncRoute(async (_req, res) => { res.json(await AdmissionKnowledge.find({ deletedAt: null }).sort({ updatedAt: -1 }).limit(1500).lean()); }));
router.post('/knowledge-import-public', requireAdminOnly, asyncRoute(async (req, res) => {
  const result = await importPublicUniversityDrafts(req.user!.id);
  await recordEvent('public_knowledge_drafts_imported', undefined, result, req.user!.id); res.json(result);
}));
const knowledgeSchema = z.object({ title: z.string().min(1).max(200), content: z.string().min(1).max(60000), category: z.string().min(1).max(100), language: z.enum(['uz', 'ru', 'en']), approved: z.boolean(), validUntil: z.coerce.date().nullable().optional() });
router.post('/knowledge', asyncRoute(async (req, res) => {
  const data = knowledgeSchema.parse(req.body); if (data.approved && req.user!.role !== 'admin') { res.status(403).json({ error: 'Only admins can approve knowledge' }); return; }
  const item = await AdmissionKnowledge.create({ ...data, updatedBy: req.user!.id }); await recordEvent('knowledge_created', undefined, { id: item._id }, req.user!.id); res.status(201).json(item);
}));
router.put('/knowledge/:id', asyncRoute(async (req, res) => {
  const data = knowledgeSchema.parse(req.body); if (data.approved && req.user!.role !== 'admin') { res.status(403).json({ error: 'Only admins can approve knowledge' }); return; }
  const old: any = await AdmissionKnowledge.findById(req.params.id); if (!old) { res.sendStatus(404); return; }
  const item = await AdmissionKnowledge.findOneAndUpdate({ _id: old._id, version: old.version }, { $set: { ...data, updatedBy: req.user!.id }, $inc: { version: 1 }, $push: { history: { content: old.content, title: old.title, approved: old.approved, version: old.version, at: new Date(), by: req.user!.id } } }, { new: true });
  if (!item) { res.status(409).json({ error: 'Knowledge changed. Refresh before saving.' }); return; }
  await recordEvent('knowledge_updated', undefined, { id: item._id }, req.user!.id); res.json(item);
}));
router.delete('/knowledge/:id', requireAdminOnly, asyncRoute(async (req, res) => { await AdmissionKnowledge.updateOne({ _id: req.params.id }, { $set: { deletedAt: new Date(), approved: false } }); await recordEvent('knowledge_deleted', undefined, { id: req.params.id }, req.user!.id); res.json({ deleted: true }); }));
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 1, fileSize: 8 * 1024 * 1024 } });
router.post('/knowledge-upload', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'File required' }); return; }
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (!['.txt', '.md', '.csv', '.pdf', '.docx'].includes(ext)) { res.status(400).json({ error: 'Supported: PDF, DOCX, TXT, Markdown, CSV. Scanned PDFs need OCR before upload.' }); return; }
  const buffer = req.file.buffer;
  let extracted: { text: string; truncated: boolean };
  try {
    extracted = await new Promise((resolve, reject) => {
      const child = execFile(process.execPath, ['--max-old-space-size=192', path.join(__dirname, 'extract-document.js'), ext], { timeout: 20000, maxBuffer: 500000, windowsHide: true }, (error, stdout) => {
        if (error) { reject(new Error('DOCUMENT_EXTRACTION_FAILED')); return; }
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('DOCUMENT_EXTRACTION_FAILED')); }
      });
      child.stdin?.on('error', () => {}); child.stdin?.end(buffer);
    });
  } catch { res.status(400).json({ error: 'The document is invalid, too complex, or unreadable. Please upload a smaller text-based PDF or DOCX.' }); return; }
  const text = extracted.text;
  if (!text.trim()) { res.status(400).json({ error: 'No readable text found. Scanned documents need OCR.' }); return; }
  const item = await AdmissionKnowledge.create({ title: req.file.originalname.slice(0, 200), content: text.slice(0, 60000), category: 'Documents', language: ['uz', 'ru', 'en'].includes(req.body.language) ? req.body.language : 'en', approved: false, updatedBy: req.user!.id, sourceFilename: req.file.originalname.slice(0, 200) });
  await recordEvent('knowledge_uploaded', undefined, { id: item._id }, req.user!.id); res.status(201).json({ item, truncated: extracted.truncated });
}));
router.get('/slots', asyncRoute(async (_req, res) => { res.json(await AdmissionSlot.find({ end: { $gte: new Date(Date.now() - 30 * 86400000) } }).sort({ leadId: -1, start: 1 }).limit(2000).populate('leadId', 'name phone').lean()); }));
router.post('/slots', asyncRoute(async (req, res) => {
  const data = z.object({ consultantId: z.string().min(1).max(100), consultantName: z.string().min(1).max(120), start: z.coerce.date(), end: z.coerce.date(), mode: z.enum(['online', 'office']), location: z.string().min(1).max(500) }).parse(req.body);
  const slot = await createSlot(data); await recordEvent('slot_created', undefined, { slotId: slot._id }, req.user!.id); res.status(201).json(slot);
}));
router.patch('/slots/:id', asyncRoute(async (req, res) => {
  const data = z.object({ cancelled: z.boolean().optional(), attendance: z.enum(['pending', 'attended', 'missed']).optional() }).parse(req.body);
  const slot: any = await AdmissionSlot.findById(req.params.id); if (!slot) { res.sendStatus(404); return; }
  if (data.attendance && data.attendance !== 'pending' && (+new Date(slot.start) > Date.now() || !slot.leadId)) { res.status(409).json({ error: 'Attendance can only be recorded for a booked consultation that has started' }); return; }
  if (data.cancelled && slot.leadId) {
    const lead: any = await AdmissionLead.findById(slot.leadId);
    if (lead) { await cancelBooking(String(slot._id), lead, req.user!.id); await sendLead(lead, 'Your consultation was cancelled by the team. /book — select another time.'); }
  }
  Object.assign(slot, data); await slot.save();
  if (data.attendance && slot.bookingId) await AdmissionBooking.updateOne({ _id: slot.bookingId, status: 'active' }, { $set: { attendance: data.attendance, attendanceRecordedAt: new Date() } });
  if (data.attendance === 'attended' && slot.leadId) {
    const lead = await AdmissionLead.findByIdAndUpdate(slot.leadId, { $set: { status: 'consultation_completed' } }, { new: true });
    if (lead) { await markMilestone(lead, 'consultation_completed'); await maybeScheduleFollowup(lead, await settings()); }
  }
  await recordEvent('slot_updated', slot.leadId, { slotId: slot._id, ...data }, req.user!.id); res.json(slot);
}));
router.get('/events', asyncRoute(async (req, res) => { const filter = req.query.unresolved === 'true' ? { resolvedAt: null } : {}; res.json(await AdmissionEvent.find(filter).sort({ createdAt: -1 }).limit(200).lean()); }));
router.patch('/events/:id', asyncRoute(async (req, res) => { await AdmissionEvent.updateOne({ _id: req.params.id }, { $set: { resolvedAt: new Date() } }); res.json({ resolved: true }); }));
router.get('/jobs', asyncRoute(async (_req, res) => { res.json(await AdmissionJob.find().sort({ createdAt: -1 }).limit(200).lean()); }));
router.patch('/jobs/:id', asyncRoute(async (req, res) => {
  const input = z.object({ status: z.enum(['cancelled', 'pending']), due: z.coerce.date().optional() }).parse(req.body);
  await AdmissionJob.updateOne({ _id: req.params.id, status: { $ne: 'sent' } }, { $set: input }); res.json({ updated: true });
}));
router.post('/retention-cleanup', requireAdminOnly, asyncRoute(async (req, res) => {
  const cfg = await settings(); const cutoff = new Date(Date.now() - cfg.retentionDays * 86400000);
  const leads = await AdmissionLead.find({ updatedAt: { $lt: cutoff }, status: { $in: ['closed', 'not_interested'] } }).limit(100);
  for (const lead of leads) await deleteLeadData(lead);
  await recordEvent('retention_cleanup', undefined, { count: leads.length }, req.user!.id); res.json({ deleted: leads.length });
}));
router.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = error?.statusCode || error?.status;
  if ([401, 403, 503].includes(status)) { res.status(status).json({ error: status === 401 ? 'Sign in required' : status === 403 ? 'Staff access required' : 'Database temporarily unavailable' }); return; }
  if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }); return; }
  if (['SLOT_OVERLAP', 'CALENDAR_BUSY', 'SLOT_UNAVAILABLE', 'FOLLOWUP_NOT_PERMITTED', 'INVALID_FOLLOWUP_DATE', 'INVALID_SLOT_TIME'].includes(error?.message)) { res.status(409).json({ error: error.message }); return; }
  if (error?.code === 11000) { res.status(409).json({ error: 'This record already exists' }); return; }
  res.status(500).json({ error: 'The operation failed. Please retry or check integration events.' });
});
export default router;
