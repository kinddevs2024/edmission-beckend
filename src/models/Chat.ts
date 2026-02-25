import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
  },
  { timestamps: true }
);

chatSchema.index({ studentId: 1, universityId: 1 }, { unique: true });
chatSchema.index({ studentId: 1 });
chatSchema.index({ universityId: 1 });

export const Chat = mongoose.model('Chat', chatSchema);
