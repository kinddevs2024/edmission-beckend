import mongoose from 'mongoose';

const experienceSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['volunteer', 'internship', 'work'], required: true },
    title: String,
    organization: String,
    startDate: Date,
    endDate: Date,
    description: String,
  },
  { _id: true }
);

const portfolioWorkSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    fileUrl: String,
    linkUrl: String,
  },
  { _id: true }
);

const languageLevelSchema = new mongoose.Schema(
  {
    language: { type: String, required: true },
    level: { type: String, required: true },
  },
  { _id: false }
);

const studentProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    firstName: String,
    lastName: String,
    birthDate: Date,
    country: String,
    city: String,
    gradeLevel: String,
    gpa: Number,
    languageLevel: String,
    languages: [languageLevelSchema],
    bio: String,
    avatarUrl: String,
    schoolCompleted: Boolean,
    schoolName: String,
    graduationYear: Number,
    skills: [String],
    interests: [String],
    hobbies: [String],
    experiences: [experienceSchema],
    portfolioWorks: [portfolioWorkSchema],
    portfolioCompletionPercent: { type: Number, default: 0 },
    needsRecalculation: { type: Boolean, default: true },
    verifiedAt: { type: Date },
  },
  { timestamps: true }
);

studentProfileSchema.index({ userId: 1 });
studentProfileSchema.index({ gpa: 1 });
studentProfileSchema.index({ gradeLevel: 1 });
studentProfileSchema.index({ country: 1 });
studentProfileSchema.index({ city: 1 });
studentProfileSchema.index({ skills: 1 });
studentProfileSchema.index({ interests: 1 });
studentProfileSchema.index({ hobbies: 1 });

export const StudentProfile = mongoose.model('StudentProfile', studentProfileSchema);
