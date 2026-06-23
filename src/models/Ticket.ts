import mongoose from 'mongoose';

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
const ROLES = ['student', 'university', 'university_multi_manager', 'multi_university_admin', 'school_counsellor'] as const;

const replySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, required: true },
    message: { type: String, required: true },
    isStaff: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const ticketSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, required: true, enum: ROLES },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, enum: STATUSES, default: 'open' },
    replies: [replySchema],
  },
  { timestamps: true }
);

ticketSchema.index({ userId: 1 });
ticketSchema.index({ status: 1 });
ticketSchema.index({ createdAt: -1 });

export const Ticket = mongoose.model('Ticket', ticketSchema);
