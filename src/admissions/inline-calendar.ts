import { createHash, randomUUID } from 'crypto';
import { AdmissionCalendarAnchor, AdmissionMessage } from './models';
type Telegram = (method: string, body: Record<string, unknown>) => Promise<any>;
export async function calendarAnchor(lead: any, message: any) {
 const id=Number(message?.message_id);if(!Number.isSafeInteger(id)||String(message.chat?.id)!==String(lead.chatId)||message.from?.is_bot===false)return null;
 let anchor:any=await AdmissionCalendarAnchor.findOne({leadId:lead._id,aliases:id});if(anchor)return anchor;
 const owned=await AdmissionMessage.exists({leadId:lead._id,direction:'out',telegramMessageId:id});
 const botId=process.env.ADMISSIONS_TELEGRAM_TOKEN?.split(':')[0];
 if(!owned&&!(message.from?.is_bot===true&&String(message.from.id)===botId))return null;
 try{return await AdmissionCalendarAnchor.create({leadId:lead._id,chatId:lead.chatId,rootMessageId:id,currentMessageId:id,aliases:[id],rescheduleIds:lead.workflow?.rescheduleIds||[],displayText:message.text||'',displayOptions:{reply_markup:message.reply_markup||{inline_keyboard:[]}}});}catch(error:any){if(error.code!==11000)throw error;return AdmissionCalendarAnchor.findOne({leadId:lead._id,rootMessageId:id});}
}
export function inlineOptions(options:any={}) { return { reply_markup: { inline_keyboard: Array.isArray(options.reply_markup?.inline_keyboard)?options.reply_markup.inline_keyboard:[] } }; }
export async function editCalendar(lead:any,anchorId:any,text:string,options:any,telegram:Telegram,updateId?:number) {
 const clean=inlineOptions(options),hash=createHash('sha256').update(text+JSON.stringify(clean)).digest('hex');
 let anchor:any=await AdmissionCalendarAnchor.findOne({_id:anchorId,leadId:lead._id});if(!anchor)throw Error('CALENDAR_ANCHOR_NOT_OWNED');
 if(anchor.pendingHash===hash&&anchor.status==='sent')return{message_id:anchor.currentMessageId};
 anchor=await AdmissionCalendarAnchor.findOneAndUpdate({_id:anchor._id,leadId:lead._id},{$set:{pendingText:text,pendingOptions:clean,pendingHash:hash,status:'pending',nextAttemptAt:new Date(),attempts:0,updateId},$inc:{revision:1}},{new:true});
 await deliverCalendar(anchor._id,telegram);
 const result:any=await AdmissionCalendarAnchor.findById(anchor._id).lean();return result.status==='sent'?{message_id:result.currentMessageId}:{queued:true};
}
async function deliverCalendar(anchorId:any,telegram:Telegram){
 const owner=randomUUID();const a:any=await AdmissionCalendarAnchor.findOneAndUpdate({_id:anchorId,status:'pending',$or:[{lockedUntil:null},{lockedUntil:{$lt:new Date()}}]},{$set:{lockedUntil:new Date(Date.now()+45000),lockOwner:owner}},{new:true});if(!a)return;
 const revision=a.revision;let result:any;let target=a.currentMessageId;let fallback=false;
 try{
  try{result=await telegram('editMessageText',{chat_id:a.chatId,message_id:target,text:a.pendingText.slice(0,4000),...inlineOptions(a.pendingOptions)});}catch(error:any){
   const description=String(error.description||error.message||'');
   if(/message is not modified/i.test(description))result={message_id:target};
   else if(error.telegramCode===400&&/message to edit not found|message can't be edited|message can not be edited|message_id_invalid|message identifier is not specified/i.test(description)){
    result=await telegram('sendMessage',{chat_id:a.chatId,text:a.pendingText.slice(0,4000),...inlineOptions(a.pendingOptions)});target=result.message_id;fallback=true;
    await AdmissionCalendarAnchor.updateOne({_id:a._id,lockOwner:owner},{$set:{currentMessageId:target},$addToSet:{aliases:target}});
   }else throw error;
  }
  const current:any=await AdmissionCalendarAnchor.findOne({_id:a._id,lockOwner:owner}).lean();if(!current)return;
  await AdmissionCalendarAnchor.updateOne({_id:a._id,lockOwner:owner},{$set:{currentMessageId:target,displayText:a.pendingText,displayOptions:a.pendingOptions,deliveredRevision:revision,status:current.revision===revision?'sent':'pending',lockedUntil:null,errorCode:null,nextAttemptAt:new Date()},$push:{history:{$each:[{at:new Date(),revision,text:a.pendingText,options:a.pendingOptions,messageId:target,updateId:a.updateId,fallback}],$slice:-200}}});
  if(current.revision!==revision)await deliverCalendar(a._id,telegram);
 }catch(error:any){await AdmissionCalendarAnchor.updateOne({_id:a._id,lockOwner:owner},{$set:{lockedUntil:null,errorCode:String(error.message||'CALENDAR_EDIT_FAILED').slice(0,60),nextAttemptAt:new Date(Date.now()+60000)},$inc:{attempts:1}});}
}
export async function retryCalendarEdits(telegram:Telegram){const pending:any[]=await AdmissionCalendarAnchor.find({status:'pending',attempts:{$lt:3},nextAttemptAt:{$lte:new Date()}}).limit(20).lean();for(const a of pending)await deliverCalendar(a._id,telegram);}
