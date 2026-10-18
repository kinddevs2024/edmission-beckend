const fields = ['destination', 'degree', 'program', 'studyLanguage'];
const normalize = (text: string) => text.toLocaleLowerCase().replace(/[’‘ʻ']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function validatedStudyFacts(profile: any, evidence: any, lead: any, text: string, history: any[]) {
 const facts = { ...(lead.studyFacts || {}) }; const own = ' '+normalize([...history.filter(m=>m.direction==='in' && (!lead.onboardedAt || +new Date(m.createdAt)>=+new Date(lead.onboardedAt))).map(m=>m.text),text].join('\n'))+' ';
 for (const field of fields) { const value=profile?.[field],quote=evidence?.[field];if(typeof value!=='string'||typeof quote!=='string'||value.length>300||quote.length>500||(value.match(/\p{L}/gu)||[]).length<2)continue;const normalized=normalize(quote);if(!normalized||/^(yes|no|да|нет|ha|yoq|okay|ok)$/.test(normalized)||(normalized.match(/\p{L}/gu)||[]).length<2)continue;if(own.includes(' '+normalized+' '))facts[field]={value,quote,at:new Date()}; }
 return facts;
}
export function mayOfferConsultation(lead:any,facts:any,text:string,reply:string,hasBooking:boolean,now=new Date()) {
 const known=fields.filter(field=>typeof facts?.[field]?.value==='string'&&facts[field].quote);
 if(known.length<2||!known.some(field=>field==='destination'||field==='program'))return false;
 if(hasBooking||lead.bookingOfferDeclinedAt)return false;
 if(lead.lastBookingOfferAt&&+now-+new Date(lead.lastBookingOfferAt)<7*86400000)return false;
 if(/requirements?|documents?|what.*need|nima.*kerak|qanday.*hujjat|talablar|каки.*документ|что.*нуж|требован/i.test(text))return false;
 return true;
}
export function declinesBooking(text:string){return /^(?:no(?: thanks)?|not now|maybe later|нет(?: спасибо)?|не сейчас|пока нет|позже|yo['’ʻ]?q|hozir emas|keyinroq)[!.\s]*$/i.test(text.trim());}
