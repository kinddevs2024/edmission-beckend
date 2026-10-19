const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { bookingRequested } = require('../dist/admissions/general-guidance');
const { AdmissionLead, AdmissionState, AdmissionSlot } = require('../dist/admissions/models');
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
  for (const request of ['Can i make a booking','я хрчу записатса','я хрчу записатса на кансалтиг','я хочу записаться']) {
  for (const answer of [reply,'Absolutely, let us choose a time.']) {
    reply = answer;
    const chatId = ++sequence;
    await AdmissionLead.create({chatId:String(chatId),language:request.startsWith('я')?'ru':'en',languageExplicit:true,name:'Synthetic',phone:'+998900000000',onboardingStage:'complete',onboardingVersion:1,onboardedAt:new Date(0),externalAIConsent:true});
    const updateId=++sequence;
    await processUpdate({update_id:updateId,message:{message_id:updateId,chat:{id:chatId,type:'private'},from:{id:chatId},text:request}});
    const sent=calls.filter(call=>call.method==='sendMessage'&&call.body.chat_id===String(chatId)).at(-1)?.body;
    assert(sent,'Expected a reply');
    assert(sent.reply_markup?.inline_keyboard?.flat().some(button=>button.callback_data.startsWith('cal:d:')),'Explicit booking must include actual calendar dates even if Meta omits its hidden action');
  }
  }
  const {menuCopy}=require('../dist/admissions/menu');
  for(const lang of ['en','ru','uz']) {
    const chatId=++sequence, c=menuCopy[lang];
    const lead=await AdmissionLead.create({chatId:String(chatId),language:lang,languageExplicit:true,name:'Synthetic',phone:'+998900000000',onboardingStage:'complete',onboardingVersion:1,onboardedAt:new Date(0),externalAIConsent:true});
    async function send(text){const id=++sequence;await processUpdate({update_id:id,message:{message_id:id,chat:{id:chatId,type:'private'},from:{id:chatId},text}});return calls.filter(c=>c.method==='sendMessage'&&c.body.chat_id===String(chatId)).at(-1).body;}
    let sent=await send(c.help); assert.equal(sent.reply_markup.keyboard[0][0],c.book);
    sent=await send(c.book); assert(sent.reply_markup.inline_keyboard.flat().some(b=>b.callback_data.startsWith('cal:d:')));
    sent=await send(c.preferences); assert(!JSON.stringify(sent.reply_markup).includes('/external_ai')); assert(!JSON.stringify(sent.reply_markup).includes('/local_ai'));
    const slot=await AdmissionSlot.create({consultantId:'qa-'+lang,consultantName:'Synthetic',start:new Date(Date.now()+86400000),end:new Date(Date.now()+90000000),mode:'online',location:'test',leadId:lead._id});
    sent=await send(c.help); assert.equal(sent.reply_markup.keyboard[0][0],c.mine);
    slot.cancelled=true;await slot.save();sent=await send(c.help);assert.equal(sent.reply_markup.keyboard[0][0],c.book);
  }
  for(const text of ['не хочу записаться','я хочу записаться в университет','я хочу записаться к врачу'])assert(!bookingRequested(text),text);
  console.log('PASS English screenshot request: actual Telegram calendar, omitted-action recovery and negative cases');
  await mongoose.connection.dropDatabase();
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>mongoose.disconnect());
