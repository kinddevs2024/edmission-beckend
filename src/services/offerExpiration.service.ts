import { Offer } from '../models';
import * as notificationService from './notification.service';

/** Close expired offers: set status=expired for pending/waiting offers with expiresAt <= now and notify both sides. */
export async function expireOffersNow() {
  const now = new Date();
  const candidates = await Offer.find({
    status: { $in: ['pending', 'waiting'] },
    expiresAt: { $ne: null, $lte: now },
  })
    .select('studentId universityId _id')
    .lean();

  if (candidates.length === 0) return { processed: 0 };

  const ids = candidates.map((o) => (o as { _id: unknown })._id);
  await Offer.updateMany(
    { _id: { $in: ids } },
    { $set: { status: 'expired' } }
  );

  for (const raw of candidates as Array<{ _id: unknown; studentId?: unknown; universityId?: unknown }>) {
    const offerId = String(raw._id);
    const studentProfileId = raw.studentId;
    const uniProfileId = raw.universityId;
    // Notify student
    if (studentProfileId) {
      // studentProfileId -> StudentProfile -> userId
      // Import lazily to avoid circular deps
      const { StudentProfile, UniversityProfile } = await import('../models');
      const studentProfile = await StudentProfile.findById(studentProfileId).select('userId').lean();
      const uniProfile = await UniversityProfile.findById(uniProfileId).select('userId universityName').lean();

      const studentUserId = studentProfile && (studentProfile as { userId?: unknown }).userId
        ? String((studentProfile as { userId: unknown }).userId)
        : null;
      const uniUserId = uniProfile && (uniProfile as { userId?: unknown }).userId
        ? String((uniProfile as { userId: unknown }).userId)
        : null;
      const universityName = (uniProfile as { universityName?: string })?.universityName ?? 'University';

      if (studentUserId) {
        await notificationService.createNotification(studentUserId, {
          type: 'offer_expired',
          title: 'Offer expired',
          body: `Offer from ${universityName} has expired.`,
          referenceType: 'offer',
          referenceId: offerId,
        });
      }
      if (uniUserId) {
        await notificationService.createNotification(uniUserId, {
          type: 'offer_expired',
          title: 'Offer expired',
          body: 'Offer expired without student decision.',
          referenceType: 'offer',
          referenceId: offerId,
        });
      }
    }
  }

  return { processed: candidates.length };
}

