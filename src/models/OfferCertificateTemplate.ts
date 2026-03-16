import mongoose from 'mongoose';

/** Certificate template used when creating offers from universities. */
const offerCertificateTemplateSchema = new mongoose.Schema(
  {
    /** Owner university user (User._id) */
    universityUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Human‑readable template name */
    name: { type: String, required: true, maxlength: 200 },
    /** Layout key: selects one of predefined layouts in frontend */
    layoutKey: { type: String, enum: ['classic', 'modern', 'minimal'], default: 'classic' },
    /** Primary color for certificate (CSS color string) */
    primaryColor: { type: String, default: '#0F766E' },
    /** Accent color (buttons, highlights) */
    accentColor: { type: String, default: '#EC4899' },
    /** Optional background image URL */
    backgroundImageUrl: { type: String },
    /** Body template with placeholders like {{studentName}}, {{programName}}, {{date}} */
    bodyTemplate: { type: String, required: true, maxlength: 5000 },
    /** Optional title template; falls back to generic title if not provided */
    titleTemplate: { type: String },
    /** Mark as default template for this university */
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

offerCertificateTemplateSchema.index({ universityUserId: 1 });
offerCertificateTemplateSchema.index({ universityUserId: 1, isDefault: 1 });

export const OfferCertificateTemplate = mongoose.model('OfferCertificateTemplate', offerCertificateTemplateSchema);

