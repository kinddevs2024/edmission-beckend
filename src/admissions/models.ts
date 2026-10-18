import mongoose, { Schema } from 'mongoose';

// Separate collections deliberately keep the existing Telegram sign-in bot untouched.
const model = (name: string, schema: Schema) => mongoose.models[name] || mongoose.model(name, schema);
const opts = { timestamps: true };
export const leadStatuses = ['new', 'qualified', 'consultation_booked', 'consultation_completed', 'considering', 'application', 'offer', 'enrolled', 'not_interested', 'on_hold', 'closed'] as const;
export const AdmissionLead = model('AdmissionLead', new Schema({
  chatId: { type: String, unique: true, required: true }, username: String, name: String,
  language: { type: String, enum: ['uz', 'ru', 'en'], default: 'en' },
  phone: String, status: { type: String, enum: leadStatuses, default: 'new' },
  profile: { type: Schema.Types.Mixed, default: {} }, notes: { type: String, default: '' },
  summary: String, score: { type: Number, default: 0 }, intent: String, nextAction: String,
  objections: [String], assignedTo: String, aiPaused: { type: Boolean, default: false },
  followupConsent: { type: Boolean, default: false }, lastInboundAt: Date,
  workflow: { type: Schema.Types.Mixed, default: {} }, deletedAt: Date,
}, opts));
export const AdmissionMessage = model('AdmissionMessage', new Schema({
  leadId: { type: Schema.Types.ObjectId, required: true, index: true },
  direction: { type: String, enum: ['in', 'out', 'staff'], required: true },
  text: { type: String, required: true }, updateId: { type: Number, unique: true, sparse: true },
  telegramMessageId: Number, provider: String, sourceIds: [String], delivered: Boolean,
  responseMs: Number, errorCode: String,
}, opts));
export const AdmissionKnowledge = model('AdmissionKnowledge', new Schema({
  title: { type: String, required: true }, category: { type: String, default: 'FAQ' },
  language: { type: String, enum: ['uz', 'ru', 'en'], default: 'en' },
  content: { type: String, required: true }, approved: { type: Boolean, default: false },
  validUntil: Date, version: { type: Number, default: 1 }, updatedBy: String,
  history: [{ content: String, title: String, approved: Boolean, version: Number, at: Date, by: String }],
  deletedAt: Date, sourceFilename: String,
}, opts));
export const AdmissionSlot = model('AdmissionSlot', new Schema({
  consultantId: { type: String, required: true }, consultantName: { type: String, required: true },
  start: { type: Date, required: true }, end: { type: Date, required: true },
  mode: { type: String, enum: ['online', 'office'], required: true }, location: { type: String, required: true },
  leadId: { type: Schema.Types.ObjectId, default: null }, cancelled: { type: Boolean, default: false },
  confirmedAt: Date, attendance: { type: String, enum: ['pending', 'attended', 'missed'], default: 'pending' },
}, opts).index({ consultantId: 1, start: 1 }, { unique: true }));
export const AdmissionJob = model('AdmissionJob', new Schema({
  leadId: { type: Schema.Types.ObjectId, index: true },
  kind: { type: String, enum: ['reminder', 'followup', 'staff'], required: true },
  dedupeKey: { type: String, unique: true, required: true }, slotId: Schema.Types.ObjectId,
  due: { type: Date, required: true }, text: String,
  status: { type: String, enum: ['pending', 'sending', 'sent', 'cancelled', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 }, lockedUntil: Date, errorCode: String, sentAt: Date,
  inboundVersion: Date,
}, opts).index({ status: 1, due: 1 }));
export const AdmissionEvent = model('AdmissionEvent', new Schema({
  leadId: Schema.Types.ObjectId, actor: String, kind: { type: String, required: true },
  detail: { type: Schema.Types.Mixed, default: {} }, resolvedAt: Date,
}, opts).index({ kind: 1, createdAt: -1 }));
export const AdmissionState = model('AdmissionState', new Schema({
  key: { type: String, unique: true, required: true },
  value: { type: Schema.Types.Mixed, default: {} },
}, opts));
