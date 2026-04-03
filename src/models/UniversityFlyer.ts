import { Schema, model, Types } from 'mongoose';

const universityFlyerSchema = new Schema(
  {
    // Index is declared via `universityFlyerSchema.index(...)` below.
    universityId: { type: Schema.Types.ObjectId, ref: 'UniversityProfile', required: true },
    title: { type: String, trim: true },
    source: { type: String, enum: ['upload', 'url', 'editor'], default: 'url' },
    mediaUrl: { type: String, trim: true },
    mediaType: { type: String, trim: true },
    canvasJson: { type: String },
    pageFormat: { type: String, enum: ['A4_PORTRAIT', 'A4_LANDSCAPE', 'LETTER', 'CUSTOM'] },
    width: { type: Number },
    height: { type: Number },
    editorVersion: { type: String, trim: true },
    previewImageUrl: { type: String, trim: true },
    isPublished: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

universityFlyerSchema.index({ universityId: 1, createdAt: -1 });

export interface UniversityFlyerDoc {
  _id: Types.ObjectId;
  universityId: Types.ObjectId;
  title?: string;
  source?: 'upload' | 'url' | 'editor';
  mediaUrl?: string;
  mediaType?: string;
  canvasJson?: string;
  pageFormat?: 'A4_PORTRAIT' | 'A4_LANDSCAPE' | 'LETTER' | 'CUSTOM';
  width?: number;
  height?: number;
  editorVersion?: string;
  previewImageUrl?: string;
  isPublished?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const UniversityFlyer = model('UniversityFlyer', universityFlyerSchema);
