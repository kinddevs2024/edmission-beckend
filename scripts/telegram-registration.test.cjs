const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const states = new Map();
const sent = [], completed = [];
let returning = false;
const sessionId = 'a'.repeat(32);
const models = {
  TelegramBotSession: {
    findOne({chatId}) { return {lean: async () => states.get(chatId) || null}; },
    async findOneAndUpdate({chatId}, patch) { states.set(chatId, {...states.get(chatId), ...patch}); },
  },
};
const auth = {
  getTelegramWebsiteAuthSessionLanguage: async () => 'ru',
  bindTelegramWebsiteAuthSession: async () => returning
    ? {ok:true, ready:true, loginLink:'https://edmission.uz/auth/telegram?token=existing'}
    : {ok:true, ready:false},
  findUserByTelegramChatId: async () => null,
  findUserByPhone: async () => null,
  completeTelegramWebsiteAuthFromBot: async payload => {
    completed.push(payload);
    return {ok:true, loginLink:'https://edmission.uz/auth/telegram?token=test'};
  },
};
Module._load = function(request, parent, main) {
  if (parent?.filename.endsWith('/dist/services/telegramBot.service.js')) {
    if (request === '../models') return models;
    if (request === '../config') return {config:{telegram:{botToken:'',frontendBaseUrl:'https://edmission.uz'}}};
    if (request === '../utils/logger') return {logger:{info(){},warn(){},error(){}}};
    if (request === './auth.service') return auth;
    if (request === './notification.service') return {};
    if (request === './telegram.service') return {
      sendTelegramMessage: async (...args) => sent.push({kind:'message',args}),
      sendTelegramKeyboard: async (...args) => sent.push({kind:'keyboard',args}),
      removeTelegramKeyboard: async () => {},
    };
  }
  return originalLoad.apply(this, arguments);
};
const {handleTelegramUpdate} = require('../dist/services/telegramBot.service');
Module._load = originalLoad;
const update = (id, fields, from = id, type = 'private') => ({update_id:id,message:{chat:{id,type},from:{id:from,first_name:'Ali',last_name:'Valiyev'},...fields}});
(async () => {
  await handleTelegramUpdate(update(101,{text:`/start LOGIN_${sessionId}`}));
  assert.equal(states.get('101').mode,'await_telegram_auth_contact');
  assert.equal(states.get('101').telegramAuthFirstName,'Ali');
  assert(sent.some(row => row.kind==='keyboard' && row.args[2].flat().some(button => button.request_contact)));
  console.log('PASS new website login requests own contact directly, retaining Telegram name');
  await handleTelegramUpdate(update(101,{contact:{phone_number:'+998901234567',user_id:999}}));
  assert.equal(completed.length,0);
  console.log('PASS someone else’s contact cannot complete registration');
  await handleTelegramUpdate(update(101,{contact:{phone_number:'+998901234567',user_id:101}}));
  assert.equal(completed.length,1);
  assert.equal(completed[0].firstName,'Ali');
  assert.equal(completed[0].lastName,'Valiyev');
  assert.equal(completed[0].sessionId,sessionId);
  assert(sent.some(row => row.args[3]?.inline_keyboard?.flat().some(button => button.url?.includes('token=test'))));
  console.log('PASS own contact completes registration and returns a website button');
  const count = sent.length;
  await handleTelegramUpdate(update(102,{text:`/start LOGIN_${sessionId}`},103));
  await handleTelegramUpdate(update(-104,{text:`/start LOGIN_${sessionId}`},104,'group'));
  assert.equal(sent.length,count);
  console.log('PASS mismatched sender and group chats are ignored');
  returning=true;
  await handleTelegramUpdate(update(105,{text:`/start LOGIN_${sessionId}`}));
  assert(sent.some(row => row.args[3]?.inline_keyboard?.flat().some(button => button.url?.includes('token=existing'))));
  assert.equal(states.get('105').mode,'idle');
  console.log('PASS returning linked user receives the website button without onboarding again');
})().catch(error => {console.error(error);process.exitCode=1;});
