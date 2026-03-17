import mongoose from 'mongoose';

const STUDENT_ISSUED_DOCUMENT_TYPES = ['offer', 'scholarship'] as const;
const STUDENT_ISSUED_DOCUMENT_STATUSES = ['sent', 'viewed', 'accepted', 'declined', 'postponed', 'expired', 'revoked'] as const;

const studentIssuedDocumentSchema = new mongoose.Schema(
  {
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentTemplate', required: true },
    type: { type: String, required: true, enum: STUDENT_ISSUED_DOCUMENT_TYPES },
    status: { type: String, required: true, enum: STUDENT_ISSUED_DOCUMENT_STATUSES, default: 'sent' },
    pageFormat: { type: String, enum: ['A4_PORTRAIT', 'A4_LANDSCAPE', 'LETTER', 'CUSTOM'] },
    width: { type: Number },
    height: { type: Number },
    title: { type: String, maxlength: 300 },
    universityMessage: { type: String, maxlength: 2000 },
    renderedPayload: { type: mongoose.Schema.Types.Mixed, required: true },
    frozenTemplateJson: { type: String, required: true },
    resolvedCanvasJson: { type: String },
    pdfUrl: { type: String },
    previewImageUrl: { type: String },
    sentAt: { type: Date, required: true, default: Date.now },
    viewedAt: { type: Date },
    decisionAt: { type: Date },
    postponeUntil: { type: Date },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
    deletedByUniversityAt: { type: Date },
  },
  { timestamps: true }
);

studentIssuedDocumentSchema.index({ universityId: 1, createdAt: -1 });
studentIssuedDocumentSchema.index({ studentId: 1, createdAt: -1 });
studentIssuedDocumentSchema.index({ chatId: 1, createdAt: -1 });
studentIssuedDocumentSchema.index({ status: 1, expiresAt: 1 });
studentIssuedDocumentSchema.index({ status: 1, postponeUntil: 1 });

export const StudentIssuedDocument = mongoose.model('StudentIssuedDocument', studentIssuedDocumentSchema);
