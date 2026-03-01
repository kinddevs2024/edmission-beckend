import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
  },
  { _id: false }
);

const aiConversationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, required: true, enum: ['student', 'university'] },
    messages: [messageSchema],
  },
  { timestamps: true }
);

aiConversationSchema.index({ userId: 1 }, { unique: true });

export const AIConversation = mongoose.model('AIConversation', aiConversationSchema);
