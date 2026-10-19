const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { bookingRequested } = require('../dist/admissions/general-guidance');
const { AdmissionLead, AdmissionState } = require('../dist/admissions/models');
const { processUpdate } = require('../dist/admissions/service');
const { aiTransport, defaultSettings } = require('../dist/admissions/assistant');
process.env.MODEL_API_KEY = 'synthetic';
process.env.ADMISSIONS_TELEGRAM_TOKEN = '123:synthetic';
let reply = 'Of course! Please pick an available time below to complete your booking.';
let sequence = 90000;
const calls = [];
aiTransport.meta = async () => ({ ok: true, json: async () => ({output_text: JSON.stringify({kind:'conversation',reply,sourceIds:[]})}) });
global.fetch = async (url,init) => {
  assert(String(url).startsWith('https://api.telegram.org/bot123:synthetic/'));
  calls.push({method:String(url).split('/').at(-1),body:JSON.parse(init.body)});
  return {ok:true,json:async()=>({ok:true,result:{message_id:++sequence}})};
};
(async () => {
  const uri = `mongodb://127.0.0.1:27941/admissions_qa_english_booking_${Date.now()}`;
  await mongoose.connect(uri);
  assert.equal(await AdmissionLead.countDocuments(),0);
  await AdmissionState.create({key:'settings',value:{...defaultSettings,staffChatId:''}});
  for (const text of ['Can i make a booking','Can I make a booking?','Could I make a reservation?','Can I book?']) assert(bookingRequested(text),text);
  for (const text of ['I do not want to make a booking','Can I make a hotel booking?','Can I make a booking for a flight?','What documents do I need?']) assert(!bookingRequested(text),text);
  for (const answer of [reply,'Absolutely, let us choose a time.']) {
    reply = answer;
    const chatId = ++sequence;
    await AdmissionLead.create({chatId:String(chatId),language:'en',languageExplicit:true,name:'Synthetic',phone:'+998900000000',onboardingStage:'complete',onboardingVersion:1,onboardedAt:new Date(0),externalAIConsent:true});
    const updateId=++sequence;
    await processUpdate({update_id:updateId,message:{message_id:updateId,chat:{id:chatId,type:'private'},from:{id:chatId},text:'Can i make a booking'}});
    const sent=calls.filter(call=>call.method==='sendMessage'&&call.body.chat_id===String(chatId)).at(-1)?.body;
    assert(sent,'Expected a reply');
    assert(sent.reply_markup?.inline_keyboard?.flat().some(button=>button.callback_data.startsWith('cal:d:')),'Explicit booking must include actual calendar dates even if Meta omits its hidden action');
  }
  console.log('PASS English screenshot request: actual Telegram calendar, omitted-action recovery and negative cases');
  await mongoose.connection.dropDatabase();
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>mongoose.disconnect());
