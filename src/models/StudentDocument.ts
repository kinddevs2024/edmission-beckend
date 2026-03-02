import mongoose from 'mongoose';

const studentDocumentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'StudentProfile', required: true },
    type: { type: String, required: true, enum: ['transcript', 'diploma', 'language_certificate', 'course_certificate', 'passport', 'id_card', 'other'] },
    name: { type: String },
    certificateType: { type: String },
    score: { type: String },
    fileUrl: { type: String, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String },
  },
  { timestamps: true }
);

studentDocumentSchema.index({ studentId: 1 });
studentDocumentSchema.index({ status: 1 });

export const StudentDocument = mongoose.model('StudentDocument', studentDocumentSchema);
