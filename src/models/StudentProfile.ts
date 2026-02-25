import mongoose from 'mongoose';

const studentProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    firstName: String,
    lastName: String,
    birthDate: Date,
    country: String,
    gradeLevel: String,
    gpa: Number,
    languageLevel: String,
    bio: String,
    avatarUrl: String,
    portfolioCompletionPercent: { type: Number, default: 0 },
    needsRecalculation: { type: Boolean, default: true },
  },
  { timestamps: true }
);

studentProfileSchema.index({ userId: 1 });
studentProfileSchema.index({ gpa: 1 });
studentProfileSchema.index({ gradeLevel: 1 });
studentProfileSchema.index({ country: 1 });

export const StudentProfile = mongoose.model('StudentProfile', studentProfileSchema);
