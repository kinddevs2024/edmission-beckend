const assert=require('node:assert/strict');
const mongoose=require('mongoose');
const express=require('express');
const {AdmissionLead:Lead,AdmissionMessage:Message,AdmissionBooking:Booking,AdmissionSlot:Slot,AdmissionCalendarAnchor:Anchor}=require('../dist/admissions/models');
const {listStaffBookings,staffConversationPage,listStaffQuestions}=require('../dist/admissions/admin-data');
async function main(){
 await mongoose.connect('mongodb://127.0.0.1:27939/admissions_qa_admin_data_20261018?directConnection=true');await mongoose.connection.dropDatabase();
 let passed=0;const check=(name,fn)=>{fn();passed++;console.log('PASS',name);};
 const a=await Lead.create({chatId:'81001',name:'Literal [student].*',language:'ru'}),b=await Lead.create({chatId:'81002',name:'Other student',language:'en'});
 const slot=await Slot.create({consultantId:'qa',consultantName:'QA consultant',start:new Date('2030-01-01T04:00Z'),end:new Date('2030-01-01T05:00Z'),leadId:b._id,mode:'office',location:'QA'});
 await Booking.create({reservationKey:'old',slotId:slot._id,leadId:a._id,start:slot.start,end:slot.end,bookedAt:new Date(),status:'cancelled'});
 await Booking.create({reservationKey:'new',slotId:slot._id,leadId:b._id,start:slot.start,end:slot.end,bookedAt:new Date(),status:'active'});
 let result=await listStaffBookings(1,50,'[student].*');check('Search is escaped and cancelled historical receipt retains original student',()=>{assert.equal(result.total,1);assert.equal(String(result.items[0].leadId._id),String(a._id));assert.equal(result.items[0].status,'cancelled');assert.equal(result.items[0].slot.location,'QA');});
 result=await listStaffBookings(1,1,'','active');check('Booking pagination and status use historical receipts',()=>{assert.equal(result.total,1);assert.equal(result.items.length,1);assert.equal(String(result.items[0].leadId._id),String(b._id));});
 const messages=await Message.insertMany(Array.from({length:161},(_,i)=>({leadId:a._id,direction:i%2?'out':'in',text:'History '+i,telegramMessageId:i+1})));
 await Message.create({leadId:b._id,direction:'in',text:'Foreign history',telegramMessageId:999});
 await Anchor.create({leadId:a._id,chatId:a.chatId,rootMessageId:161,currentMessageId:200,aliases:[161,200],displayText:'Current calendar',history:[{text:'Previous calendar',at:new Date()}]});
 let before,seen=[];do{result=await staffConversationPage(String(a._id),50,before);seen.push(...result.items);before=result.nextCursor;}while(before);
 check('Cursor traverses entire history beyond150 without duplicates or foreign lead',()=>{assert.equal(seen.length,161);assert.equal(new Set(seen.map(x=>String(x._id))).size,161);assert(!seen.some(x=>x.text==='Foreign history'));});
 check('Calendar history shows latest edited text with original and revisions',()=>{const row=seen.find(x=>x.telegramMessageId===161);assert.equal(row.text,'Current calendar');assert.equal(row.originalText,'History 160');assert.equal(row.edits[0].text,'Previous calendar');});
 await Message.create({leadId:a._id,direction:'in',text:'Question exact',updateId:500,isInquiry:true});
 await Message.create({leadId:a._id,direction:'out',text:'Exact answer',replyToUpdateId:500,provider:'meta',delivered:true});
 await Message.create({leadId:b._id,direction:'out',text:'Foreign answer',replyToUpdateId:500});
 await Message.create({leadId:a._id,direction:'out',text:'Unrelated answer',replyToUpdateId:501});
 await Message.create({leadId:a._id,direction:'in',text:'Legacy question',isInquiry:true});
 await Message.create({leadId:a._id,direction:'out',text:'Legacy unrelated reply'});
 result=await listStaffQuestions(1,50,'Question exact');check('Question answer join matches both lead and exact inquiry update',()=>{assert.equal(result.total,1);assert.equal(result.items[0].direction,'in');assert.equal(result.items[0].answers.length,1);assert.equal(result.items[0].answers[0].text,'Exact answer');assert.equal(result.items[0].answers[0].direction,'out');});
 result=await listStaffQuestions(1,50,'Legacy question');check('Missing legacy update IDs cannot join unrelated replies',()=>assert.equal(result.items[0].answers.length,0));
 const {User}=require('../dist/models'),{signAccessToken}=require('../dist/utils/jwt');
 const admin=new mongoose.Types.ObjectId(),student=new mongoose.Types.ObjectId();await User.collection.insertMany([{_id:admin,email:'admin@example.test',role:'admin',tokenVersion:0},{_id:student,email:'student@example.test',role:'student',tokenVersion:0}]);
 const token=role=>signAccessToken({sub:String(role==='admin'?admin:student),email:role+'@example.test',role});
 const app=express();app.use(require('../dist/middlewares/apiLocale.middleware').apiLocaleMiddleware);app.use('/admissions',require('../dist/admissions/routes').default);app.use((err,req,res,next)=>res.status(err.name==='ZodError'?400:err.statusCode||500).json({error:'Denied'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/admissions';
 const request=(path,role)=>fetch(url+path,{headers:role?{Authorization:'Bearer '+token(role)}:{}});
 for(const path of ['/bookings','/questions','/leads/'+a._id+'/messages']){
  check('Anonymous denied '+path,()=>{});assert.equal((await request(path)).status,401);
  check('Student denied '+path,()=>{});assert.equal((await request(path,'student')).status,403);
  const response=await request(path,'admin');check('Staff allowed '+path,()=>assert.equal(response.status,200));
  const payload=await response.json();check('Localized HTTP dates and IDs retain JSON scalar types '+path,()=>{assert(payload.items.length);for(const item of payload.items){assert.equal(typeof item._id,'string');if(path==='/bookings'){assert.equal(typeof item.start,'string');assert(Number.isFinite(+new Date(item.start)));assert.equal(typeof item.leadId._id,'string');}else{assert.equal(typeof item.createdAt,'string');assert(Number.isFinite(+new Date(item.createdAt)));}}});
 }
 for(const path of ['/bookings?limit=0','/bookings?status=unknown','/questions?page=-1','/leads/'+a._id+'/messages?before=bad','/leads/bad/messages']){assert.equal((await request(path,'admin')).status,400);passed++;console.log('PASS invalid query rejected',path);}
 check('Unknown lead gives404',()=>{});assert.equal((await request('/leads/'+new mongoose.Types.ObjectId()+'/messages','admin')).status,404);
 await new Promise(r=>server.close(r));await mongoose.connection.dropDatabase();await mongoose.disconnect();console.log('TOTAL',passed);
}
main().catch(error=>{console.error(error);process.exit(1);});
