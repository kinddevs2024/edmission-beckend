import mongoose from 'mongoose';

/** Investor/partner displayed on landing or admin-managed list. */
const investorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    logoUrl: String,
    websiteUrl: String,
    description: String,
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

investorSchema.index({ order: 1 });

export const Investor = mongoose.model('Investor', investorSchema);
