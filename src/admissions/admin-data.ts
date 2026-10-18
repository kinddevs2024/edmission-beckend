import mongoose from 'mongoose';
import { AdmissionBooking, AdmissionCalendarAnchor, AdmissionLead, AdmissionMessage, AdmissionSlot } from './models';

const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const leadLookup = () => [
  { $lookup: { from: AdmissionLead.collection.name, localField: 'leadId', foreignField: '_id', as: 'student' } },
  { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
];
const studentSearch = (q: string, includeText = false) => q ? [{ $match: { $or: [
  ...['student.name', 'student.username', 'student.phone', ...(includeText ? ['text'] : [])].map(field => ({ [field]: { $regex: escaped(q), $options: 'i' } })),
] } }] : [];
const studentFields = { _id: '$student._id', name: '$student.name', username: '$student.username', phone: '$student.phone', language: '$student.language', profile: '$student.profile' };

export async function listStaffBookings(page: number, limit: number, q = '', status = 'all') {
  const [result] = await AdmissionBooking.aggregate([
    ...(status === 'all' ? [] : [{ $match: { status } }]), ...leadLookup(), ...studentSearch(q),
    { $sort: { start: -1, _id: -1 } },
    { $facet: { count: [{ $count: 'total' }], items: [
      { $skip: (page - 1) * limit }, { $limit: limit },
      { $lookup: { from: AdmissionSlot.collection.name, localField: 'slotId', foreignField: '_id', as: 'slot' } },
      { $unwind: { path: '$slot', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, leadId: studentFields, slotId: 1, start: 1, end: 1, bookedAt: 1, status: 1, attendance: 1, cancelledAt: 1,
        slot: { mode: '$slot.mode', location: '$slot.location', consultantName: '$slot.consultantName', consultantId: '$slot.consultantId' } } },
    ] } },
  ]);
  return { items: result?.items || [], total: result?.count?.[0]?.total || 0, page, limit };
}

export async function staffConversationPage(leadId: string, limit: number, before?: string) {
  const rows: any[] = await AdmissionMessage.find({ leadId, ...(before ? { _id: { $lt: new mongoose.Types.ObjectId(before) } } : {}) })
    .select('direction text provider sourceIds delivered responseMs telegramMessageId createdAt updatedAt replyToUpdateId inquiryOutcome errorCode')
    .sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const messageIds = page.map(row => row.telegramMessageId).filter(Number.isFinite);
  const anchors: any[] = messageIds.length ? await AdmissionCalendarAnchor.find({ leadId, $or: [
    { rootMessageId: { $in: messageIds } }, { currentMessageId: { $in: messageIds } }, { aliases: { $in: messageIds } },
  ] }).select('rootMessageId currentMessageId aliases displayText history updatedAt').lean() : [];
  const items = page.reverse().map(row => {
    const anchor = anchors.find(item => [item.rootMessageId, item.currentMessageId, ...(item.aliases || [])].includes(row.telegramMessageId));
    return anchor ? { ...row, text: anchor.displayText || row.text, originalText: row.text,
      edits: (anchor.history || []).map((edit: any) => ({ text: edit.text, at: edit.at })), editedAt: anchor.updatedAt } : row;
  });
  return { items, hasMore, nextCursor: hasMore && items.length ? String(items[0]._id) : null };
}

export async function listStaffQuestions(page: number, limit: number, q = '') {
  const [result] = await AdmissionMessage.aggregate([
    { $match: { direction: 'in', isInquiry: true } }, ...leadLookup(), ...studentSearch(q, true), { $sort: { _id: -1 } },
    { $facet: { count: [{ $count: 'total' }], items: [
      { $skip: (page - 1) * limit }, { $limit: limit },
      { $lookup: { from: AdmissionMessage.collection.name, let: { lead: '$leadId', update: '$updateId' }, pipeline: [
        { $match: { direction: 'out', $expr: { $and: [{ $ne: [{ $ifNull: ['$$update', null] }, null] }, { $eq: ['$leadId', '$$lead'] }, { $eq: ['$replyToUpdateId', '$$update'] }] } } },
        { $sort: { _id: 1 } }, { $project: { direction: 1, text: 1, provider: 1, delivered: 1, createdAt: 1, errorCode: 1 } },
      ], as: 'answers' } },
      { $project: { _id: 1, direction: 1, text: 1, createdAt: 1, inquiryOutcome: 1, leadId: studentFields, answers: 1 } },
    ] } },
  ]);
  return { items: result?.items || [], total: result?.count?.[0]?.total || 0, page, limit };
}
