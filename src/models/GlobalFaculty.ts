import mongoose from 'mongoose';

const globalFacultySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    items: { type: [String], default: [] },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

globalFacultySchema.index({ order: 1, name: 1 });

export const GlobalFaculty = mongoose.model('GlobalFaculty', globalFacultySchema);
