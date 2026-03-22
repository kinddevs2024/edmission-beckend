import mongoose from 'mongoose';

const VISIT_ROLES = ['anonymous', 'student', 'university', 'admin', 'school_counsellor'] as const;

const siteVisitSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true, trim: true, maxlength: 120 },
    visitedOn: { type: Date, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    role: { type: String, enum: VISIT_ROLES, default: 'anonymous' },
    path: { type: String, default: '/', maxlength: 300 },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

siteVisitSchema.index({ visitorId: 1, visitedOn: 1 }, { unique: true });
siteVisitSchema.index({ visitedOn: 1, role: 1 });
siteVisitSchema.index({ visitedOn: 1, userId: 1 });

export const SiteVisit = mongoose.model('SiteVisit', siteVisitSchema);
