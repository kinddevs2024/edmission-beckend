/* Independent website/API QA: all users, messages and bookings live in a fresh loopback QA database. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const uri = process.env.ADMISSIONS_WEB_QA_URI || `mongodb://127.0.0.1:27941/admissions_qa_web_e2e_${Date.now()}`;
if (!/^mongodb:\/\/127\.0\.0\.1:27941\/admissions_qa_web_e2e_\d+$/.test(uri)) throw Error('FRESH_ISOLATED_QA_DATABASE_REQUIRED');
Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: uri, DATABASE_URL: uri, EMAIL_ENABLED: 'false',
  PORT: '4196', HOST: '127.0.0.1', FRONTEND_URL: 'http://localhost:4197', BACKEND_URL: 'http://localhost:4197',
  CORS_ORIGIN: 'http://localhost:4197', JWT_SECRET: crypto.randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: crypto.randomBytes(32).toString('hex'),
  ADMISSIONS_TELEGRAM_TOKEN: '', TELEGRAM_BOT_TOKEN: '', LLAMA_API_KEY: 'synthetic-qa-placeholder', MODEL_API_KEY: 'synthetic-qa-placeholder' });
if (process.env.ADMISSIONS_WEB_QA_REAL_META === '1') {
  const protectedEnv = fs.readFileSync(process.env.ADMISSIONS_WEB_QA_META_ENV, 'utf8');
  for (const key of ['MODEL_API_KEY', 'LLAMA_API_KEY']) {
    const value = protectedEnv.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim();
    if (value) process.env[key] = value.replace(/^['"]|['"]$/g, '');
  }
  if (process.env.MODEL_API_KEY === 'synthetic-qa-placeholder') throw Error('REAL_META_KEY_MISSING');
}
const ordinaryFetch = global.fetch;
let telegramCalls = 0, metaCalls = 0, delayedRelease;
global.fetch = async (...args) => {
  if (/api\.telegram\.org/.test(String(args[0]))) { telegramCalls++; throw Error('TELEGRAM_NETWORK_FORBIDDEN_IN_WEBSITE_QA'); }
  return ordinaryFetch(...args);
};
const app = require('../dist/app').default;
const { User, StudentProfile } = require('../dist/models');
const M = require('../dist/admissions/models');
const assistant = require('../dist/admissions/assistant');
let knowledgeId;
if (process.env.ADMISSIONS_WEB_QA_REAL_META !== '1') assistant.aiTransport.meta = async (_url, init) => {
  metaCalls++;
  const body = JSON.parse(init.body), messages = body.input || body.messages;
  const text = String(messages.at(-1)?.content || '');
  if (text.includes('QA_DELAY')) await new Promise(resolve => { delayedRelease = resolve; });
  if (text.includes('QA_FAIL')) return { ok: false, status: 503, json: async () => ({ error: { code: 'SYNTHETIC_TEST_FAILURE' } }) };
  const booking = /book|запис|консультац|yozil/i.test(text);
  const answer = text.includes('fixture')
    ? { kind: 'answer', reply: 'QA synthetic guidance: discuss your study goals at a consultation.', sourceIds: [knowledgeId], needsHuman: false, profile: {} }
    : { kind: 'conversation', reply: booking ? 'Давайте выберем удобное время консультации.' : 'Я понял ваш вопрос. Продолжим обсуждение.', sourceIds: [], needsHuman: false, profile: {}, ...(booking ? { action: { type: 'show_booking_calendar' } } : {}) };
  return { ok: true, status: 200, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }) };
};
const base = 'http://127.0.0.1:4196/api';
let assertions = 0;
function check(value, label) { assert.ok(value, label); assertions++; console.log(`PASS ${label}`); }
async function request(route, token, body, expected = 200, language = 'ru') {
  const response = await ordinaryFetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-User-Language': language, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  assert.equal(response.status, expected, `${route}: expected ${expected}, received ${response.status}: ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}
const buttons = session => session.messages.flatMap(message => (message.options?.reply_markup?.inline_keyboard || []).flat().map(button => ({ ...button, messageId: message.id })));
const matching = (session, expression) => buttons(session).find(button => expression.test(button.callback_data));
const action = (token, button, requestId = crypto.randomUUID(), expected = 200) => {
  assert.ok(button, 'Expected a visible inline button');
  return request('/admissions/web/actions', token, { data: button.callback_data, messageId: button.messageId, requestId }, expected);
};
const message = (token, text, requestId = crypto.randomUUID(), expected = 200) => request('/admissions/web/messages', token, { text, requestId }, expected);

(async () => {
  await mongoose.connect(uri);
  check(await User.countDocuments() === 0, 'database starts empty');
  const password = crypto.randomBytes(18).toString('base64url') + '!aA1';
  const passwordHash = await bcrypt.hash(password, 10);
  const suffix = Date.now();
  const accounts = [
    { role: 'student', name: 'QA Student Alpha', language: 'ru', phone: '+998900000001', email: `web-alpha-${suffix}@example.invalid` },
    { role: 'student', name: 'QA Student Beta', language: 'ru', phone: '+998900000001', email: `web-beta-${suffix}@example.invalid` },
    { role: 'admin', name: 'QA Administrator', language: 'ru', phone: '+998900000002', email: `web-admin-${suffix}@example.invalid` },
    { role: 'student', name: 'QA Browser Student', language: 'ru', phone: '', email: `web-browser-${suffix}@example.invalid` },
  ];
  const users = await User.create(accounts.map(user => ({ ...user, passwordHash, emailVerified: true, localPasswordConfigured: true, mustChangePassword: false, onboardingTutorialSeen: true })));
  for (const user of users.filter(user => user.role === 'student')) await StudentProfile.create({ userId: user._id, firstName: user.name, onboardingCompleted: true, educationStatus: 'finished_school', schoolCompleted: true });
  const knowledge = await M.AdmissionKnowledge.create({ title: 'Synthetic QA fixture', content: 'QA synthetic guidance: discuss your study goals at a consultation.', language: 'ru', approved: true });
  knowledgeId = String(knowledge._id);
  await M.AdmissionState.init();
  const sequence = require('../dist/admissions/web-transport').nextWebSequence;
  const concurrentIds = await Promise.all(Array.from({ length: 20 }, () => sequence()));
  check(new Set(concurrentIds).size === 20 && concurrentIds.every(value => value < 0), 'first concurrent website sequence initialization is unique and Telegram-safe');
  await M.AdmissionState.create({ key: 'settings', value: { ...assistant.defaultSettings, staffChatId: '', availability: { ...assistant.defaultSettings.availability, consultantId: 'web-qa-only', consultantName: 'QA Consultant', monthsAhead: 2, mode: 'online', location: 'Synthetic QA meeting' } } });
  const telegramLead = await M.AdmissionLead.create({ chatId: '987654321', name: 'QA Separate Telegram', phone: users[0].phone, channel: 'telegram' });
  const server = app.listen(4196, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const credentialsPath = process.env.ADMISSIONS_WEB_QA_CREDENTIALS || path.resolve('.qa/web-ai-credentials.json');
  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(credentialsPath, JSON.stringify({ uiUrl: 'http://localhost:4197/login', uri, student: { email: users[3].email, password }, admin: { email: users[2].email, password } }, null, 2), { mode: 0o600 });
  try {
    if (process.env.ADMISSIONS_WEB_QA_SERVE_ONLY === '1' && process.env.ADMISSIONS_WEB_QA_SERVE === '1') {
      console.log(JSON.stringify({ database: mongoose.connection.name, credentialsFile: credentialsPath, api: base, provider: process.env.ADMISSIONS_WEB_QA_REAL_META === '1' ? 'real Meta; synthetic QA profiles only' : 'mocked Meta transport' }));
      console.log('ISOLATED_QA_SERVER_READY'); return;
    }
    await request('/admissions/web/session', null, undefined, 401);
    check(true, 'anonymous chat rejected');
    const auth = [];
    for (const user of users) auth.push(await request('/auth/login', null, { email: user.email, password }));
    const [a, b, admin] = auth.map(value => value.accessToken);
    const noPhone = await request('/admissions/web/session', auth[3].accessToken, undefined, 200, 'uz');
    check(noPhone.lead.onboardingStage === 'complete' && noPhone.lead.phone === '' && !noPhone.messages.some(row => /Telefon raqamingizni|Share your phone|номер телефона/.test(row.text)), 'first website visit with no phone skips phone registration');
    await M.AdmissionLead.deleteOne({ _id: noPhone.lead.id });
    check(auth.every(value => value.accessToken && value.user), 'normal password login works for all isolated accounts');
    let sa = await request('/admissions/web/session', a);
    check(sa.lead.name === users[0].name && sa.lead.phone === users[0].phone && sa.lead.language === 'ru' && sa.lead.onboardingStage === 'complete', 'existing profile name phone and language reused');
    await User.updateOne({ _id: users[0]._id }, { $set: { phone: '', name: '' } });
    await StudentProfile.updateOne({ userId: users[0]._id }, { $set: { firstName: 'Platform', lastName: 'Student', preferredCountries: ['CA'], targetDegreeLevel: 'master' } });
    await M.AdmissionLead.updateOne({ _id: sa.lead.id }, { $set: { onboardingStage: 'phone', phoneConfirmed: false } });
    sa = await request('/admissions/web/session', a, undefined, 200, 'en');
    check(sa.lead.name === 'Platform Student' && sa.lead.phone === '' && sa.lead.onboardingStage === 'complete', 'old website phone intake repaired without requiring an optional number');
    check(sa.lead.language === 'en', 'platform request language overrides stored chat and account language');
    const synced = await M.AdmissionLead.findById(sa.lead.id).lean();
    check(synced.profile.destination === 'CA' && synced.profile.degree === 'master', 'academic platform preferences synchronize to assistant profile');
    await User.updateOne({ _id: users[0]._id }, { $set: { phone: users[0].phone, name: users[0].name } });
    await StudentProfile.updateOne({ userId: users[0]._id }, { $set: { firstName: users[0].name, lastName: '' } });
    sa = await request('/admissions/web/session', a);
    check(sa.lead.language === 'ru', 'changing platform language updates existing conversation without registration');
    const initialIds = sa.messages.map(item => item.id);
    check(JSON.stringify((await request('/admissions/web/session', a)).messages.map(item => item.id)) === JSON.stringify(initialIds), 'refresh does not duplicate welcome');
    let sb = await request('/admissions/web/session', b);
    check(sa.lead.id !== sb.lead.id && sa.lead.id !== String(telegramLead._id), 'matching phone never merges website users or Telegram identities');
    check(await M.AdmissionLead.countDocuments({ channel: 'website' }) === 2, 'website leads retain explicit channel');
    const beforeConsent = metaCalls;
    sa = await message(a, 'Hello, please answer my fixture question');
    check(metaCalls === beforeConsent && Boolean(matching(sa, /^ai:consent$/)), 'explicit Meta consent required before external inference');
    await action(b, matching(sa, /^ai:consent$/), crypto.randomUUID(), 400);
    check(true, 'another user cannot click a foreign message button');
    sa = await action(a, matching(sa, /^ai:consent$/));
    check(sa.lead.externalAIConsent, 'consent action persists for authenticated owner');
    const id = crypto.randomUUID();
    sa = await message(a, 'Please answer this fixture question', id);
    check(sa.messages.some(item => item.text.includes('QA synthetic guidance')), 'approved-source AI reply is rendered');
    const count = sa.messages.length, calls = metaCalls;
    const replay = await message(a, 'Please answer this fixture question', id);
    check(replay.messages.length === count && metaCalls === calls, 'same request replay does not rerun AI or duplicate messages');
    await message(a, 'Different payload', id, 409);
    check(true, 'same identifier with different content rejected');
    await request('/admissions/web/messages', a, { text: 'Cross account attempt', requestId: crypto.randomUUID(), leadId: sb.lead.id }, 400);
    check(true, 'caller cannot select another lead');
    check(!(await request('/admissions/web/session', b)).messages.some(item => item.text.includes('fixture question')), 'private history never leaks to another account');
    const slowId = crypto.randomUUID(), slow = message(a, 'QA_DELAY: hello', slowId);
    for (let n = 0; n < 100 && !delayedRelease; n++) await new Promise(resolve => setTimeout(resolve, 50));
    check(Boolean(delayedRelease), 'delayed synthetic model request began');
    const during = await request('/admissions/web/session', a);
    check(during.typing && during.processing, 'typing and processing visible during inference');
    await message(a, 'QA_DELAY: hello', slowId, 202);
    await message(a, 'Conflicting simultaneous new message', crypto.randomUUID(), 409);
    check(true, 'different concurrent request cannot overwrite an active conversation turn');
    delayedRelease(); sa = await slow;
    check(!sa.typing && !sa.processing, 'typing clears after reply');
    sa = await message(a, 'Хочу записаться на консультацию');
    let dayA = matching(sa, /^cal:d:/);
    check(Boolean(dayA), 'direct booking opens real available calendar');
    const calendarId = dayA.messageId;
    sa = await action(a, dayA);
    const timeA = matching(sa, /^cal:t:/);
    check(timeA?.messageId === calendarId, 'choosing day edits the same calendar bubble');
    const hours = buttons(sa).filter(button => /^cal:t:/.test(button.callback_data)).map(button => Number(button.text.split(':')[0]));
    check(hours.length > 0 && hours.every(hour => hour >= 9 && hour <= 17), 'available start hours stay within 09 through 17 Tashkent');
    sa = await action(a, timeA);
    const confirmA = matching(sa, /^cal:c:/);
    check(confirmA?.messageId === calendarId, 'choosing hour edits the same calendar bubble');
    sb = await message(b, 'Hello'); sb = await action(b, matching(sb, /^ai:consent$/));
    sb = await message(b, 'Хочу записаться на консультацию');
    sb = await action(b, matching(sb, new RegExp('^' + dayA.callback_data + '$')));
    sb = await action(b, matching(sb, new RegExp('^' + timeA.callback_data + '$')));
    const confirmB = matching(sb, /^cal:c:/), confirmationId = crypto.randomUUID();
    sa = await action(a, confirmA, confirmationId);
    const booked = await M.AdmissionBooking.findOne({ leadId: sa.lead.id, status: 'active' }).lean();
    check(Boolean(booked) && matching(sa, /^cancel:/)?.messageId === calendarId && !matching(sa, /^booking-helpful:/), 'booking confirms in same bubble without retired feedback button');
    await action(a, confirmA, confirmationId);
    check(await M.AdmissionBooking.countDocuments({ leadId: sa.lead.id, status: 'active' }) === 1, 'confirmation replay creates only one booking');
    sb = await action(b, confirmB);
    check(await M.AdmissionBooking.countDocuments({ slotId: booked.slotId, status: 'active' }) === 1, 'competing user cannot double-book an occupied slot');
    check(!buttons(sb).some(button => button.callback_data === timeA.callback_data), 'occupied hour disappears after competing booking');
    const staffBookings = await request('/admissions/bookings', admin);
    check(staffBookings.items.some(item => String(item._id) === String(booked._id) && item.leadId.channel === 'website'), 'booking appears in the existing staff calendar records');
    const history = await request(`/admissions/leads/${sa.lead.id}/messages`, admin);
    check(history.items.some(item => item.direction === 'in' && item.text.includes('fixture')) && history.items.some(item => item.direction === 'out' && item.provider === 'meta'), 'staff sees both sides and provider in website conversation');
    await request(`/admissions/leads/${sa.lead.id}/messages`, b, undefined, 403);
    check(true, 'students cannot use staff conversation API');
    const restored = await request('/admissions/web/session', a);
    check(restored.messages.some(item => item.id === calendarId && item.text === sa.messages.find(item => item.id === calendarId)?.text), 'refresh retains the edited booking confirmation');
    const failed = await message(a, 'QA_FAIL: synthetic provider outage');
    check(!failed.typing && !failed.processing && failed.messages.some(item => /не получилось получить ответ ИИ/.test(item.text)), 'provider failure is visible and releases typing and request lease');
    await message(a, 'x'.repeat(4001), crypto.randomUUID(), 400);
    check(true, 'oversized messages rejected before persistence');
    const leadA = await M.AdmissionLead.findById(sa.lead.id).lean();
    check(leadA.language === 'ru' && leadA.name === users[0].name && leadA.phone === users[0].phone, 'profile and chosen interface language survive full conversation');
    await M.AdmissionMessage.insertMany(Array.from({ length: 105 }, (_, n) => ({ leadId: sa.lead.id, direction: 'in', text: `Synthetic pagination fixture ${n}` })));
    const page = await request('/admissions/web/session', a);
    check(page.messages.length === 100 && Boolean(page.nextCursor), 'long conversation uses bounded history and older-page cursor');
    const older = await request(`/admissions/web/session?before=${page.nextCursor}`, a);
    check(older.messages.length > 0 && !older.messages.some(item => page.messages.some(recent => recent.id === item.id)), 'older history page persists and does not overlap');
    for (const completed of [false, true]) {
      const requestId = crypto.randomUUID(), text = completed ? 'Recovered delivered turn' : 'Interrupted abandoned turn', updateId = await sequence();
      const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ kind: 'message', text, requestId })).digest('hex');
      await M.AdmissionWebRequest.create({ userId: users[0]._id, requestId, payloadHash, updateId, status: 'processing' });
      if (completed) {
        const row = await M.AdmissionMessage.create({ leadId: sa.lead.id, direction: 'out', text, delivered: true, replyToUpdateId: updateId, telegramMessageId: updateId });
        await M.AdmissionWebDelivery.create({ chatId: leadA.chatId, messageId: updateId, receiptId: row._id, text, options: {} });
      }
      await message(a, text, requestId, completed ? 200 : 503);
      check((await M.AdmissionWebRequest.findOne({ userId: users[0]._id, requestId }).lean()).status === (completed ? 'done' : 'failed'), completed ? 'abandoned request with delivered answer recovers instead of eternal processing' : 'abandoned request without answer reports interruption instead of eternal processing');
    }
    const leadB = await M.AdmissionLead.findById(sb.lead.id);
    check(await M.AdmissionWebRequest.countDocuments({ userId: users[1]._id }) > 0, 'privacy deletion fixture contains website request records');
    await require('../dist/admissions/service').deleteLeadData(leadB);
    check(await M.AdmissionWebRequest.countDocuments({ userId: users[1]._id }) === 0 && await M.AdmissionWebDelivery.countDocuments({ chatId: leadB.chatId }) === 0, 'privacy deletion removes website request and delivery history');
    check(await M.AdmissionLead.exists({ _id: telegramLead._id }), 'website deletion leaves independent Telegram identity intact');
    check(telegramCalls === 0, 'website flow makes no Telegram network calls');
    console.log(JSON.stringify({ passed: assertions, database: mongoose.connection.name, credentialsFile: credentialsPath, api: base, provider: 'mocked Meta transport; real service and database' }));
    if (process.env.ADMISSIONS_WEB_QA_SERVE === '1') { console.log('ISOLATED_QA_SERVER_READY'); return; }
  } finally {
    if (process.env.ADMISSIONS_WEB_QA_SERVE !== '1') { await new Promise(resolve => server.close(resolve)); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; if (process.env.ADMISSIONS_WEB_QA_SERVE !== '1') mongoose.disconnect(); });
