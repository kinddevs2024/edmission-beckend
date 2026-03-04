import mongoose from 'mongoose';

const studentProfileViewSchema = new mongoose.Schema(
  {
    /** University user id (role: 'university') */
    universityUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /** Viewed student profile id */
    studentProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
  },
  { timestamps: true }
);

studentProfileViewSchema.index({ universityUserId: 1, studentProfileId: 1 }, { unique: true });

export const StudentProfileView = mongoose.model('StudentProfileView', studentProfileViewSchema);

