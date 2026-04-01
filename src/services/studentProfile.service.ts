import { StudentProfile, User } from '../models';
import { AppError, ErrorCodes } from '../utils/errors';

export async function ensureStudentProfile(userId: string) {
  const existing = await StudentProfile.findOne({ userId });
  if (existing) return existing;

  const user = await User.findById(userId).select('role').lean();
  if (!user) {
    throw new AppError(404, 'User not found', ErrorCodes.NOT_FOUND);
  }
  if ((user as { role?: string }).role !== 'student') {
    throw new AppError(404, 'Student profile not found', ErrorCodes.NOT_FOUND);
  }

  return StudentProfile.create({ userId });
}
