import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AppError, ErrorCodes } from '../utils/errors';

const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
  'image/jfif',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'application/pdf',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
] as const;

/** Flyers and large assets; keep aligned with frontend accept lists. */
const MAX_SIZE = 50 * 1024 * 1024;

const dir = path.resolve(config.uploadDir);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const ALLOWED_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
  '.jfif',
  '.heic',
  '.heics',
  '.heif',
  '.heifs',
  '.pdf',
  '.webm',
  '.mp4',
  '.m4a',
  '.mp3',
  '.mov',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
  '.txt',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, dir),
  filename: (_req, file, cb) => {
    const raw = path.extname(file.originalname || '')?.toLowerCase();
    const ext = raw && ALLOWED_EXT.has(raw) ? raw : '.bin';
    cb(null, `${uuidv4()}${ext}`);
  },
});

export const uploadSingle = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const mimeOk = ALLOWED_MIMES.includes(mime as (typeof ALLOWED_MIMES)[number]);
    const extOk = Boolean(ext && ALLOWED_EXT.has(ext));
    const looseMime = mime === 'application/octet-stream' || mime === '';

    if (extOk && (mimeOk || looseMime)) {
      cb(null, true);
      return;
    }
    if (mimeOk && (!ext || ALLOWED_EXT.has(ext))) {
      cb(null, true);
      return;
    }
    cb(
      new AppError(
        400,
        'Invalid file type. Allowed: images (including HEIC/HEIF), PDF, video (MP4, WebM, MOV), Office documents (Word, Excel, PowerPoint), text, and audio (WebM, MP4, MP3).',
        ErrorCodes.VALIDATION
      )
    );
  },
}).single('file');
