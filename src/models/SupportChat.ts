import mongoose from 'mongoose';

const supportChatSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assignedAdminId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    lastMessageAt: { type: Date },
  },
  { timestamps: true }
);

supportChatSchema.index({ userId: 1 }, { unique: true });
supportChatSchema.index({ status: 1, updatedAt: -1 });

export const SupportChat = mongoose.model('SupportChat', supportChatSchema);
