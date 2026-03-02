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

const schoolAttendedSchema = new mongoose.Schema(
  {
    country: String,
    institutionName: String,
    /** 'school' | 'university' — for labels and minimal-profile logic */
    institutionType: { type: String, enum: ['school', 'university'] },
    educationLevel: String,
    gradingScheme: String,
    gradeScale: Number,
    gradeAverage: Number,
    primaryLanguage: String,
    attendedFrom: Date,
    attendedTo: Date,
    degreeName: String,
  },
  { _id: true }
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
    /** 'in_school' | 'finished_school' | 'in_university' | 'finished_university' — drives labels and minimal profile */
    educationStatus: { type: String, enum: ['in_school', 'finished_school', 'in_university', 'finished_university'] },
    schoolCompleted: Boolean,
    schoolName: String,
    graduationYear: Number,
    gradingScheme: String,
    gradeScale: Number,
    highestEducationLevel: String,
    schoolsAttended: [schoolAttendedSchema],
    targetDegreeLevel: { type: String, enum: ['bachelor', 'master', 'phd'] },
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
