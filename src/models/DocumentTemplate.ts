import mongoose from 'mongoose';

const DOCUMENT_TEMPLATE_TYPES = ['offer', 'scholarship'] as const;
const DOCUMENT_TEMPLATE_STATUSES = ['draft', 'active', 'archived'] as const;
const DOCUMENT_PAGE_FORMATS = ['A4_PORTRAIT', 'A4_LANDSCAPE', 'LETTER', 'CUSTOM'] as const;

const documentTemplateSchema = new mongoose.Schema(
  {
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, required: true, enum: DOCUMENT_TEMPLATE_TYPES },
    name: { type: String, required: true, maxlength: 200 },
    status: { type: String, required: true, enum: DOCUMENT_TEMPLATE_STATUSES, default: 'draft' },
    pageFormat: { type: String, required: true, enum: DOCUMENT_PAGE_FORMATS, default: 'A4_PORTRAIT' },
    width: { type: Number },
    height: { type: Number },
    editorVersion: { type: String, required: true, default: '1.0.0' },
    canvasJson: { type: String, required: true },
    previewImageUrl: { type: String },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

documentTemplateSchema.index({ universityId: 1, type: 1, status: 1 });
documentTemplateSchema.index({ universityId: 1, updatedAt: -1 });
documentTemplateSchema.index({ universityId: 1, type: 1, isDefault: 1 });

export const DocumentTemplate = mongoose.model('DocumentTemplate', documentTemplateSchema);

