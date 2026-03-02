import mongoose from 'mongoose';

const facultySchema = new mongoose.Schema(
  {
    universityId: { type: mongoose.Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

facultySchema.index({ universityId: 1 });
facultySchema.index({ universityId: 1, order: 1 });

export const Faculty = mongoose.model('Faculty', facultySchema);
