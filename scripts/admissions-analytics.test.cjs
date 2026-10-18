const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { AdmissionLead: Lead, AdmissionMessage: Message, AdmissionBooking: Booking, AdmissionJob: Job, AdmissionState: State, AdmissionEvent: Event } = require('../dist/admissions/models');
const { admissionAnalytics, ratio, markMilestone } = require('../dist/admissions/analytics');
const { parseAnswer } = require('../dist/admissions/assistant');
const d = date => new Date(date + (date.includes('T') ? '' : 'T00:00:00Z'));
async function main() {
  const uri = 'mongodb://127.0.0.1:27939/admissions_qa_metrics_20261018?directConnection=true';
  await mongoose.connect(uri); await mongoose.connection.dropDatabase();
  await State.create({ key: 'analytics-tracking', value: { startedAt: d('2026-01-01'), version: 1 } });
  let checks = 0; const check = (label, fn) => { fn(); checks++; console.log('PASS', label); };
  const leads = await Lead.create([
    { chatId: 'a', analyticsVersion: 1, createdAt: d('2026-01-11'), status: 'enrolled', milestones: { new: d('2026-01-11'), qualified: d('2026-01-12'), consultation_booked: d('2026-01-13'), consultation_completed: d('2026-01-14'), application: d('2026-01-15'), offer: d('2026-01-16'), enrolled: d('2026-01-21') } },
    { chatId: 'b', analyticsVersion: 1, createdAt: d('2026-01-12'), status: 'considering', milestones: { new: d('2026-01-12'), qualified: d('2026-01-13'), consultation_booked: d('2026-01-14'), consultation_completed: d('2026-01-15') } },
    { chatId: 'c', analyticsVersion: 1, createdAt: d('2026-01-13'), status: 'application', milestones: { new: d('2026-01-13'), application: d('2026-01-14') } },
    { chatId: 'd', analyticsVersion: 1, createdAt: d('2026-01-14'), status: 'enrolled', milestones: { new: d('2026-01-14') } },
    { chatId: 'legacy', createdAt: d('2026-01-15'), status: 'offer' },
    { chatId: 'outside', analyticsVersion: 1, createdAt: d('2026-01-21'), status: 'enrolled', milestones: { new: d('2026-01-21'), enrolled: d('2026-01-22') } },
  ]);
  const leadId = leads[0]._id;
  await Message.create([
    ...['ai_answered', 'ai_resolved', 'handover', 'unanswered'].map((outcome, i) => ({ leadId, direction: 'in', text: i < 2 ? 'What are the fees?' : 'How do I apply?', updateId: i + 1, analyticsVersion: 1, isInquiry: true, inquiryOutcome: outcome, createdAt: d('2026-01-12') })),
    { leadId, direction: 'in', text: '/book', updateId: 10, analyticsVersion: 1, isInquiry: false, createdAt: d('2026-01-12') },
    { leadId, direction: 'in', text: 'Legacy question', updateId: 11, createdAt: d('2026-01-12') },
    { leadId, direction: 'out', text: 'First reply', analyticsVersion: 1, delivered: true, replyToUpdateId: 1, inboundAt: d('2026-01-12T10:00:00Z'), sentAt: d('2026-01-12T10:00:02Z') },
    { leadId, direction: 'out', text: 'Second reply to same inquiry', analyticsVersion: 1, delivered: true, replyToUpdateId: 1, inboundAt: d('2026-01-12T10:00:00Z'), sentAt: d('2026-01-12T10:00:09Z') },
    { leadId, direction: 'staff', text: 'Staff first reply', analyticsVersion: 1, delivered: true, replyToUpdateId: 2, inboundAt: d('2026-01-12T11:00:00Z'), sentAt: d('2026-01-12T11:00:08Z') },
    { leadId, direction: 'out', text: 'Not delivered', analyticsVersion: 1, delivered: false, replyToUpdateId: 3, inboundAt: d('2026-01-12T12:00:00Z') },
  ]);
  await Event.create({ leadId, kind: 'handover_requested', createdAt: d('2026-01-13') });
  await Job.create([
    ...['sent', 'sent', 'failed', 'pending', 'cancelled'].map((status, i) => ({ leadId, kind: 'reminder', dedupeKey: 'reminder-' + i, analyticsVersion: 1, status, due: d('2026-02-01'), originalDue: d('2026-01-13') })),
    { leadId, kind: 'reminder', dedupeKey: 'old-reminder', status: 'sent', due: d('2026-01-13') },
    ...[
      { sentAt: d('2026-01-11'), respondedAt: d('2026-01-12') },
      { sentAt: d('2026-01-12') },
      { sentAt: d('2026-01-18'), respondedAt: d('2026-01-19') },
      { sentAt: d('2026-01-19') },
      { sentAt: d('2026-01-12'), respondedAt: d('2026-01-21') },
    ].map((times, i) => ({ leadId, kind: 'followup', dedupeKey: 'followup-' + i, analyticsVersion: 1, status: 'sent', due: times.sentAt, ...times })),
  ]);
  await Booking.create(['attended', 'missed', 'pending', 'attended'].map((attendance, i) => ({ reservationKey: 'booking-' + i, slotId: new mongoose.Types.ObjectId(), leadId, bookedAt: d('2026-01-11'), start: d('2026-01-13'), end: d('2026-01-13T01:00:00Z'), attendance, status: i === 3 ? 'cancelled' : 'active' })));
  const metrics = await admissionAnalytics(d('2026-01-10'), d('2026-01-20'), d('2026-01-22'));
  check('Current statuses are not used as historical cohort milestones', () => { assert.equal(metrics.cohort.count, 4); assert.equal(metrics.cohort.stages.find(s => s.stage === 'enrolled').observed, 1); assert.equal(metrics.currentStatusSnapshot.find(s => s._id === 'enrolled').count, 2); });
  check('Legacy and out-of-period leads do not invent cohort history', () => { assert.equal(metrics.activity.newLeads, 5); assert.equal(metrics.cohort.count, 4); });
  check('Conversion uses intersections of recorded ordered stages', () => { const stage = metrics.cohort.stages.find(s => s.stage === 'application'); assert.equal(stage.observed, 2); assert.equal(stage.fromPrevious.numerator, 1); assert.equal(stage.fromPrevious.denominator, 2); assert.equal(stage.fromPrevious.percent, 50); });
  check('Consultation-to-application and application-to-enrollment conversions do not require optional stages', () => { assert.deepEqual(metrics.cohort.transitions.consultationToApplication, { numerator: 1, denominator: 2, percent: 50 }); assert.deepEqual(metrics.cohort.transitions.applicationToEnrollment, { numerator: 1, denominator: 2, percent: 50 }); });
  check('Cohort observes later outcomes through explicit as-of date', () => assert.equal(metrics.cohort.stages.find(s => s.stage === 'enrolled').shareOfCohort.percent, 25));
  check('Reminder denominator uses original due date, excludes cancellations and legacy unknowns', () => assert.deepEqual(metrics.reminders.delivered, { numerator: 2, denominator: 4, percent: 50 }));
  check('Seven-day follow-up rate excludes open windows and late responses', () => { assert.deepEqual(metrics.followups.responseRate7Days, { numerator: 1, denominator: 3, percent: 33.33 }); assert.equal(metrics.followups.pendingObservation, 2); assert.equal(metrics.followups.respondedSoFar, 2); });
  check('Attendance excludes cancellations and displays missing records separately', () => { assert.deepEqual(metrics.attendance.recordedRate, { numerator: 1, denominator: 2, percent: 50 }); assert.equal(metrics.attendance.recordingCoverage.denominator, 3); assert.equal(metrics.attendance.counts.pending, 1); });
  check('Latency counts only the first successfully delivered response per inquiry', () => { assert.equal(metrics.latency.replies, 2); assert.equal(metrics.latency.averageMs, 5000); assert.equal(metrics.latency.minMs, 2000); assert.equal(metrics.latency.maxMs, 8000); });
  check('Resolved AI inquiries require explicit feedback; commands excluded from inquiry rates', () => { assert.equal(metrics.activity.trackedInquiries, 4); assert.equal(metrics.inquiries.aiAnswered, 2); assert.equal(metrics.inquiries.studentConfirmedResolved, 1); assert.equal(metrics.inquiries.handovers, 1); });
  check('FAQ and unanswered lists are based on tracked student questions', () => { assert.equal(metrics.frequentlyAsked.find(q => q._id === 'what are the fees?').count, 2); assert.equal(metrics.unanswered.length, 1); assert.equal(metrics.unanswered[0].count, 1); });
  const missing = await admissionAnalytics(d('2026-01-02'), d('2026-01-03'), d('2026-01-22'));
  check('No historical denominator yields n/a, never a fabricated zero-percent rate', () => { assert.equal(missing.reminders.delivered.percent, null); assert.equal(missing.followups.responseRate7Days.percent, null); assert.equal(missing.attendance.recordedRate.percent, null); assert.equal(missing.latency.averageMs, null); });
  const before = leads[1].milestones.qualified; await markMilestone(leads[1], 'qualified', d('2026-01-20'));
  check('First milestone timestamp is durable and not rewritten by repeated status edits', () => assert.equal(+new Date(leads[1].milestones.qualified), +new Date(before)));
  const source = { _id: 'approved-fee', title: 'Fees', content: 'Consultation fee: 100 USD.' };
  const invented = parseAnswer(JSON.stringify({ reply: 'The consultation fee is 1000 USD.', sourceIds: ['approved-fee'] }), [source]);
  check('A valid citation cannot authorize an invented numerical fee', () => { assert.equal(invented.needsHuman, true); assert.equal(invented.reply, ''); });
  const correct = parseAnswer(JSON.stringify({ reply: 'The consultation fee is 100 USD.', sourceIds: ['approved-fee'] }), [source]);
  check('Approved numeric facts remain available', () => { assert.equal(correct.needsHuman, false); assert(correct.reply.includes('100 USD')); });
  const publicService = require('../dist/services/public.service');
  const { publicUniversityText, importPublicUniversityDrafts } = require('../dist/admissions/public-knowledge');
  const university = { _source: 'profile', id: 'public-test-university', universityName: 'Public Test University', country: 'Canada', city: 'Toronto', description: 'Published student-facing description.', minLanguageLevel: 'IELTS 6.5', tuitionPrice: 123456, email: 'private@example.test', userId: 'private-user', documents: [{ fileUrl: 'private-file' }] };
  const importedText = publicUniversityText(university);
  check('University import selects only public fields and excludes unqualified prices and private data', () => { assert(importedText.includes('Canada')); assert(!importedText.includes('123456')); assert(!importedText.includes('private')); });
  publicService.getPublicUniversities = async () => ({ data: [university], total: 1, totalPages: 1 });
  const firstImport = await importPublicUniversityDrafts('qa-staff');
  const { AdmissionKnowledge: Knowledge } = require('../dist/admissions/models');
  let draft = await Knowledge.findOne({ sourceRecordId: 'profile:public-test-university' });
  check('Published university data still requires explicit knowledge approval', () => { assert.equal(firstImport.created, 1); assert.equal(draft.approved, false); assert(draft.sourceUrl.startsWith('https://edmission.uz/api/public/universities')); });
  draft.content = 'Staff-reviewed correction'; draft.approved = true; await draft.save();
  const repeated = await importPublicUniversityDrafts('qa-staff'); draft = await Knowledge.findById(draft._id);
  check('Unchanged source synchronization preserves staff edits and approval', () => { assert.equal(repeated.unchanged, 1); assert.equal(draft.content, 'Staff-reviewed correction'); assert.equal(draft.approved, true); });
  university.description = 'Updated published description'; const changed = await importPublicUniversityDrafts('qa-staff'); draft = await Knowledge.findById(draft._id);
  check('Changed public source creates a new draft with prior version history', () => { assert.equal(changed.updated, 1); assert.equal(draft.approved, false); assert.equal(draft.history[0].content, 'Staff-reviewed correction'); assert.equal(draft.version, 2); });
  console.log(`${checks} analytics and grounding checks passed`);
  await mongoose.connection.dropDatabase(); await mongoose.disconnect();
}
main().catch(async error => { console.error(error); await mongoose.disconnect(); process.exitCode = 1; });
