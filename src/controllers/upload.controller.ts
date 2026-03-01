import type { Request, Response, NextFunction } from 'express';

export async function uploadFile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ message: 'No file uploaded' });
      return;
    }
    const url = `/api/uploads/${req.file.filename}`;
    res.status(201).json({ url });
  } catch (e) {
    next(e);
  }
}
