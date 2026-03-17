import mongoose from 'mongoose';

const STUDENT_DOCUMENT_EVENT_ACTORS = ['university', 'student', 'system'] as const;
const STUDENT_DOCUMENT_EVENT_TYPES = [
  'created',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'postponed',
  'expired',
  'revoked',
  'chat_message_created',
  'notification_sent',
] as const;

const studentDocumentEventSchema = new mongoose.Schema(
  {
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentIssuedDocument', required: true },
    actorType: { type: String, required: true, enum: STUDENT_DOCUMENT_EVENT_ACTORS },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    eventType: { type: String, required: true, enum: STUDENT_DOCUMENT_EVENT_TYPES },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

studentDocumentEventSchema.index({ documentId: 1, createdAt: 1 });
studentDocumentEventSchema.index({ eventType: 1, createdAt: -1 });

export const StudentDocumentEvent = mongoose.model('StudentDocumentEvent', studentDocumentEventSchema);
