import mongoose from 'mongoose';

/** Certificate or testimonial displayed on landing (university or student). */
const landingCertificateSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['university', 'student'], required: true },
    title: { type: String, required: true },
    imageUrl: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

landingCertificateSchema.index({ type: 1, order: 1 });

export const LandingCertificate = mongoose.model('LandingCertificate', landingCertificateSchema);
