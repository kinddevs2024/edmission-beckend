import mongoose from 'mongoose';

/** Invitation from school (counsellor) to student. Student must accept or decline. Until then, school cannot access student data. */
const STATUSES = ['pending', 'accepted', 'declined'] as const;

const schoolInvitationSchema = new mongoose.Schema(
  {
    counsellorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    studentUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, default: 'pending', enum: STATUSES },
    respondedAt: { type: Date },
  },
  { timestamps: true }
);

schoolInvitationSchema.index({ counsellorUserId: 1, studentUserId: 1 }, { unique: true });
schoolInvitationSchema.index({ studentUserId: 1, status: 1 });
schoolInvitationSchema.index({ counsellorUserId: 1, status: 1 });

export const SchoolInvitation = mongoose.model('SchoolInvitation', schoolInvitationSchema);
