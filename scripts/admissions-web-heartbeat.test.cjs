const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { AdmissionState } = require('../dist/admissions/models');
const { startWebsiteLeaseHeartbeat } = require('../dist/admissions/web-transport');
const wait = duration => new Promise(resolve => setTimeout(resolve, duration));
(async () => {
  await mongoose.connect(`mongodb://127.0.0.1:27941/admissions_qa_web_e2e_${Date.now()}`);
  try {
    const key = 'web-lock:qa-owner';
    await AdmissionState.create({ key, value: { owner: 'owner-a', until: new Date(0) } });
    const stop = startWebsiteLeaseHeartbeat(key, 'owner-a', 10, 200);
    await wait(60);
    const renewed = await AdmissionState.findOne({ key }).lean();
    assert.ok(+new Date(renewed.value.until) > Date.now());
    await stop();
    const stoppedAt = +(await AdmissionState.findOne({ key }).lean()).value.until;
    await wait(40);
    assert.equal(+(await AdmissionState.findOne({ key }).lean()).value.until, stoppedAt);
    const sentinel = new Date(Date.now() + 500000);
    await AdmissionState.updateOne({ key }, { $set: { value: { owner: 'owner-b', until: sentinel } } });
    const stopOther = startWebsiteLeaseHeartbeat(key, 'owner-a', 10, 200);
    await wait(40); await stopOther();
    const unchanged = await AdmissionState.findOne({ key }).lean();
    assert.equal(unchanged.value.owner, 'owner-b');
    assert.equal(+new Date(unchanged.value.until), +sentinel);
    console.log('4 website lease heartbeat renewal, stop and ownership checks passed');
  } finally { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; mongoose.disconnect(); });
