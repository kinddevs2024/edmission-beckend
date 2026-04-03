import mongoose from 'mongoose';

const counsellorProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    schoolName: { type: String, default: '' },
    schoolDescription: { type: String, default: '' },
    country: { type: String, default: '' },
    city: { type: String, default: '' },
    /** Public: show this school in "list of schools" for students to request to join */
    isPublic: { type: Boolean, default: true },
  },
  { timestamps: true }
);

counsellorProfileSchema.index({ schoolName: 1 });
counsellorProfileSchema.index({ isPublic: 1 });

export const CounsellorProfile = mongoose.model('CounsellorProfile', counsellorProfileSchema);
