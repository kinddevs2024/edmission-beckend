import { createHash } from 'crypto';
import { getPublicUniversities } from '../services/public.service';
import { AdmissionKnowledge } from './models';
import { detectLanguage } from './policy';

export function publicUniversityText(entry: any) {
  const lines = [String(entry.universityName || entry.name || '').trim()];
  for (const [label, field] of [['Country', 'country'], ['City', 'city'], ['Description', 'description'], ['Minimum language level', 'minLanguageLevel']]) {
    if (typeof entry[field] === 'string' && entry[field].trim()) lines.push(`${label}: ${entry[field].trim()}`);
  }
  if (typeof entry.ieltsMinBand === 'number') lines.push(`Minimum IELTS: ${entry.ieltsMinBand}`);
  if (typeof entry.gpaMinValue === 'number' && ['scale', 'percent'].includes(entry.gpaMinMode)) lines.push(`Minimum GPA: ${entry.gpaMinValue} (${entry.gpaMinMode})`);
  // No contact identities, user accounts, private documents or prices without a
  // verified currency/fee context are imported from the underlying models.
  return lines.filter(Boolean).join('\n').slice(0, 60000);
}
export async function importPublicUniversityDrafts(actor: string) {
  let created = 0; let updated = 0; let unchanged = 0; let skipped = 0; let truncated = false;
  const seen: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const result = await getPublicUniversities({ page, limit: 50 });
    truncated = result.total > 500;
    for (const entry of result.data) {
      const key = `${entry._source}:${entry.id}`; seen.push(key);
      const content = publicUniversityText(entry); if (!content) { skipped++; continue; }
      const title = String(entry.universityName || entry.name || 'University').slice(0, 200);
      const digest = createHash('sha256').update(content).digest('hex');
      const old: any = await AdmissionKnowledge.findOne({ sourceRecordId: key });
      if (old?.deletedAt) { skipped++; continue; }
      if (old?.sourceDigest === digest) { unchanged++; continue; }
      const data = { title, content, category: 'Public university catalog', language: detectLanguage(content), approved: false, validUntil: null, sourceRecordId: key, sourceUrl: `https://edmission.uz/api/public/universities?page=${page}&limit=50`, sourceDigest: digest, importedAt: new Date(), updatedBy: actor };
      if (!old) { await AdmissionKnowledge.create(data); created++; }
      else {
        await AdmissionKnowledge.updateOne({ _id: old._id, version: old.version }, { $set: data, $inc: { version: 1 }, $push: { history: { content: old.content, title: old.title, approved: old.approved, version: old.version, at: new Date(), by: actor } } }); updated++;
      }
    }
    if (page >= result.totalPages) break;
  }
  let unavailable = 0;
  if (!truncated) {
    const result = await AdmissionKnowledge.updateMany({ category: 'Public university catalog', sourceRecordId: { $exists: true, $nin: seen }, approved: true }, { $set: { approved: false, validUntil: new Date(), updatedBy: actor } }); unavailable = result.modifiedCount;
  }
  return { created, updated, unchanged, skipped, unavailable, truncated, approvalRequired: true };
}
