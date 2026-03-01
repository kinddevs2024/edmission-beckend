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
  'application/pdf',
] as const;

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

const dir = path.resolve(config.uploadDir);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf']);

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
    const ext = path.extname(file.originalname || '')?.toLowerCase();
    const mimeOk = ALLOWED_MIMES.includes(file.mimetype as (typeof ALLOWED_MIMES)[number]);
    const extOk = !ext || ALLOWED_EXT.has(ext);
    if (mimeOk && extOk) {
      cb(null, true);
    } else {
      cb(new AppError(400, 'Invalid file type. Allowed: images (JPEG, PNG, GIF, WebP) and PDF', ErrorCodes.VALIDATION));
    }
  },
}).single('file');
