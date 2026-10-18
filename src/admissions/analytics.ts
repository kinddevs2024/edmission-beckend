import { AdmissionBooking, AdmissionEvent, AdmissionJob, AdmissionLead, AdmissionMessage, AdmissionState } from './models';

export const funnelStages = ['new', 'qualified', 'consultation_booked', 'consultation_completed', 'application', 'offer', 'enrolled'] as const;
let startPromise: Promise<Date> | undefined;
export function trackingStartedAt(): Promise<Date> {
  if (!startPromise) startPromise = (async () => {
    const state: any = await AdmissionState.findOneAndUpdate({ key: 'analytics-tracking' }, { $setOnInsert: { value: { startedAt: new Date(), version: 1 } } }, { upsert: true, new: true }).lean();
    return new Date(state.value.startedAt);
  })().catch(error => { startPromise = undefined; throw error; });
  return startPromise;
}
export async function markMilestone(lead: any, stage: string, at = new Date()) {
  if (!(funnelStages as readonly string[]).includes(stage)) return;
  if (!lead.milestones?.[stage]) {
    await AdmissionLead.updateOne({ _id: lead._id, [`milestones.${stage}`]: { $exists: false } }, { $set: { [`milestones.${stage}`]: at } });
  }
}
export function ratio(numerator: number, denominator: number) {
  return { numerator, denominator, percent: denominator ? Math.round(10000 * numerator / denominator) / 100 : null };
}
export async function admissionAnalytics(from: Date, to: Date, now = new Date()) {
  const startedAt = await trackingStartedAt();
  const effectiveFrom = new Date(Math.max(+from, +startedAt));
  const activity = { $gte: from, $lt: to };
  const trackedActivity = { $gte: effectiveFrom, $lt: to };
  const trackedIncoming = { direction: 'in', isInquiry: true, analyticsVersion: 1, createdAt: trackedActivity };
  const groupFunnel: any = { _id: null, total: { $sum: 1 } };
  for (const stage of funnelStages) groupFunnel[stage] = { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: [`$milestones.${stage}`, null] }, null] }, { $lte: [`$milestones.${stage}`, now] }] }, 1, 0] } };
  for (let i = 1; i < funnelStages.length; i++) {
    const before = `$milestones.${funnelStages[i - 1]}`; const after = `$milestones.${funnelStages[i]}`;
    groupFunnel[`step_${i}`] = { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: [before, null] }, null] }, { $ne: [{ $ifNull: [after, null] }, null] }, { $lte: [before, after] }, { $lte: [after, now] }] }, 1, 0] } };
  }
  const directTransitions = [ ['consultationToApplication', 'consultation_booked', 'application'], ['completedConsultationToApplication', 'consultation_completed', 'application'], ['applicationToEnrollment', 'application', 'enrolled'] ];
  for (const [name, previous, next] of directTransitions) groupFunnel[name] = { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: [`$milestones.${previous}`, null] }, null] }, { $ne: [{ $ifNull: [`$milestones.${next}`, null] }, null] }, { $lte: [`$milestones.${previous}`, `$milestones.${next}`] }, { $lte: [`$milestones.${next}`, now] }] }, 1, 0] } };
  const [newLeads, incoming, outcomes, handovers, snapshot, funnelRows, reminderRows, followups, attendanceRows, latencyRows, questions, unanswered] = await Promise.all([
    AdmissionLead.countDocuments({ createdAt: activity }),
    AdmissionMessage.countDocuments({ direction: 'in', createdAt: activity }),
    AdmissionMessage.aggregate([{ $match: trackedIncoming }, { $group: { _id: '$inquiryOutcome', count: { $sum: 1 } } }]),
    AdmissionEvent.countDocuments({ kind: 'handover_requested', createdAt: trackedActivity }),
    AdmissionLead.aggregate([{ $match: { createdAt: activity } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    AdmissionLead.aggregate([{ $match: { createdAt: trackedActivity, analyticsVersion: 1 } }, { $group: groupFunnel }]),
    AdmissionJob.aggregate([{ $match: { kind: 'reminder', analyticsVersion: 1, originalDue: { $gte: effectiveFrom, $lt: new Date(Math.min(+to, +now)) }, status: { $ne: 'cancelled' } } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    AdmissionJob.find({ kind: 'followup', analyticsVersion: 1, status: 'sent', sentAt: trackedActivity }).select('sentAt respondedAt').lean(),
    AdmissionBooking.aggregate([{ $match: { analyticsVersion: 1, start: { $gte: effectiveFrom, $lt: new Date(Math.min(+to, +now)) }, status: 'active' } }, { $group: { _id: '$attendance', count: { $sum: 1 } } }]),
    AdmissionMessage.aggregate([{ $match: { direction: { $in: ['out', 'staff'] }, delivered: true, analyticsVersion: 1, inboundAt: trackedActivity, replyToUpdateId: { $exists: true }, sentAt: { $exists: true } } }, { $group: { _id: { leadId: '$leadId', updateId: '$replyToUpdateId' }, firstSent: { $min: '$sentAt' }, inboundAt: { $min: '$inboundAt' } } }, { $project: { ms: { $subtract: ['$firstSent', '$inboundAt'] } } }, { $match: { ms: { $gte: 0 } } }, { $group: { _id: null, averageMs: { $avg: '$ms' }, minMs: { $min: '$ms' }, maxMs: { $max: '$ms' }, count: { $sum: 1 } } }]),
    AdmissionMessage.aggregate([{ $match: trackedIncoming }, { $group: { _id: { $toLower: { $trim: { input: '$text' } } }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
    AdmissionMessage.aggregate([{ $match: { ...trackedIncoming, inquiryOutcome: 'unanswered' } }, { $group: { _id: { $toLower: { $trim: { input: '$text' } } }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
  ]);
  const counts = (rows: any[]) => Object.fromEntries(rows.map(row => [row._id || 'pending', row.count]));
  const outcomeCounts = counts(outcomes); const reminders = counts(reminderRows); const attendance = counts(attendanceRows);
  const inquiryCount = Object.values(outcomeCounts).reduce((sum: number, n: any) => sum + Number(n), 0) as number;
  const mature = followups.filter((job: any) => +new Date(job.sentAt) + 7 * 86400000 <= +now);
  const respondedInWindow = (job: any) => job.respondedAt && +new Date(job.respondedAt) >= +new Date(job.sentAt) && +new Date(job.respondedAt) <= +new Date(job.sentAt) + 7 * 86400000;
  const funnel: any = funnelRows[0] || { total: 0 };
  const stages = funnelStages.map((stage, index) => ({ stage, observed: funnel[stage] || 0, shareOfCohort: ratio(funnel[stage] || 0, funnel.total || 0), fromPrevious: index ? ratio(funnel[`step_${index}`] || 0, funnel[funnelStages[index - 1]] || 0) : null }));
  const trackedBookings = await AdmissionBooking.countDocuments({ analyticsVersion: 1, bookedAt: trackedActivity });
  return {
    range: { from, to, asOf: now, trackingStartedAt: startedAt, effectiveFrom },
    activity: { newLeads, incomingMessages: incoming, trackedBookings, trackedInquiries: inquiryCount },
    inquiries: { counts: outcomeCounts, aiAnswered: (outcomeCounts.ai_answered || 0) + (outcomeCounts.ai_resolved || 0), studentConfirmedResolved: outcomeCounts.ai_resolved || 0, handovers, aiAnswerRate: ratio((outcomeCounts.ai_answered || 0) + (outcomeCounts.ai_resolved || 0), inquiryCount), confirmedResolutionRate: ratio(outcomeCounts.ai_resolved || 0, inquiryCount) },
    reminders: { counts: reminders, delivered: ratio(reminders.sent || 0, Object.values(reminders).reduce((sum: number, n: any) => sum + Number(n), 0) as number), definition: 'Due tracked reminders in the selected period, excluding cancelled reminders; pending and failed deliveries remain in the denominator.' },
    followups: { delivered: followups.length, respondedSoFar: followups.filter(respondedInWindow).length, closedWindowCount: mature.length, pendingObservation: followups.length - mature.length, responseRate7Days: ratio(mature.filter(respondedInWindow).length, mature.length), definition: 'Response means the first non-command student message attributed to the most recent delivered follow-up. Rate uses only deliveries with a complete seven-day observation window.' },
    attendance: { counts: attendance, recordedRate: ratio(attendance.attended || 0, (attendance.attended || 0) + (attendance.missed || 0)), recordingCoverage: ratio((attendance.attended || 0) + (attendance.missed || 0), Object.values(attendance).reduce((sum: number, n: any) => sum + Number(n), 0) as number), definition: 'Tracked non-cancelled appointments already started in the selected period. Pending attendance is shown separately and excluded from the attended/missed rate.' },
    latency: latencyRows[0] ? { averageMs: latencyRows[0].averageMs, minMs: latencyRows[0].minMs, maxMs: latencyRows[0].maxMs, replies: latencyRows[0].count } : { averageMs: null, minMs: null, maxMs: null, replies: 0 },
    currentStatusSnapshot: snapshot, cohort: { count: funnel.total || 0, stages, transitions: Object.fromEntries(directTransitions.map(([name, previous]) => [name, ratio(funnel[name] || 0, funnel[previous] || 0)])), definition: 'Leads first seen inside the selected period after tracking began. Only recorded milestone timestamps are counted, observed through the stated as-of time. Skipped stages are not inferred; current statuses are not conversion history.' },
    frequentlyAsked: questions, unanswered,
  };
}
