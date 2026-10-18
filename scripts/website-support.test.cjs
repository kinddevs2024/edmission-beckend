const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const models = require('../dist/models');
// This test never contacts Telegram/email and never uses production credentials or records.
require('../dist/services/notification.service').createNotification = async () => ({});
require('../dist/services/telegram.service').sendChatMessageToTelegram = async () => undefined;
const chat = require('../dist/services/chat.service');
const uri = process.env.SUPPORT_QA_MONGO_URI || 'mongodb://127.0.0.1:27939/edmission_support_qa';
if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/edmission_support_qa(?:[/?]|$)/.test(uri)) throw Error('ISOLATED_SUPPORT_QA_DATABASE_REQUIRED');
(async () => {
  await mongoose.connect(uri);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const users = await models.User.create([
    { role: 'student', email: `support-student-${stamp}@example.invalid`, passwordHash: 'test-only' },
    { role: 'admin', email: `support-admin-${stamp}@example.invalid`, passwordHash: 'test-only' },
    { role: 'student', email: `support-other-${stamp}@example.invalid`, passwordHash: 'test-only' },
  ]);
  let supportId;
  try {
    const [student, admin, other] = users.map(u => String(u._id));
    const opened = await chat.getOrCreateChatForUser(student, { type: 'support' });
    supportId = String(opened.chatId);
    const sent = await chat.saveMessage(supportId, student, 'My support question remains visible');
    assert.equal(sent.message.text, 'My support question remains visible');
    assert.equal((await chat.getMessages(supportId, student, {})).data.length, 1);
    assert.equal((await chat.getMessages(supportId, admin, {})).data[0].text, sent.message.text);
    await chat.markRead(supportId, admin);
    assert.equal((await chat.getMessages(supportId, student, {})).data.length, 1);
    await chat.saveMessage(supportId, admin, 'Administrator response');
    const restored = await chat.getMessages(supportId, student, {});
    assert.deepEqual(restored.data.map(m => m.text), ['My support question remains visible', 'Administrator response']);
    assert.equal(await models.Message.countDocuments({ chatId: supportId }), 2);
    await assert.rejects(chat.getMessages(supportId, other, {}));
    const reopened = await chat.getOrCreateChatForUser(student, { type: 'support' });
    assert.equal(String(reopened.chatId), supportId);
    assert.equal((await chat.getMessages(supportId, student, {})).data.length, 2);
    console.log('9 website support persistence, administrator visibility, read and ownership checks passed');
  } finally {
    if (supportId) { await models.Message.deleteMany({ chatId: supportId }); await models.SupportChat.deleteOne({ _id: supportId }); }
    await models.User.deleteMany({ _id: { $in: users.map(u => u._id) } });
    await mongoose.disconnect();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; mongoose.disconnect(); });
