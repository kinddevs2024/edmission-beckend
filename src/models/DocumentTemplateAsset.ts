import mongoose from 'mongoose';

const DOCUMENT_TEMPLATE_ASSET_TYPES = ['image', 'logo', 'signature', 'background', 'pdf_background'] as const;

const documentTemplateAssetSchema = new mongoose.Schema(
  {
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentTemplate', required: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    type: { type: String, required: true, enum: DOCUMENT_TEMPLATE_ASSET_TYPES },
    fileUrl: { type: String, required: true },
    fileName: { type: String, required: true, maxlength: 260 },
    mimeType: { type: String, required: true, maxlength: 120 },
    width: { type: Number },
    height: { type: Number },
  },
  { timestamps: true }
);

documentTemplateAssetSchema.index({ templateId: 1, createdAt: 1 });
documentTemplateAssetSchema.index({ universityId: 1, type: 1 });

export const DocumentTemplateAsset = mongoose.model('DocumentTemplateAsset', documentTemplateAssetSchema);

