import { Language } from './policy';
// Public-source general orientation, separate from staff-approved Edmission business knowledge.
// Not a universal checklist or a country/university-specific eligibility determination.
export const generalPreparationSources = [
  'https://educationusa.state.gov/your-5-steps-us-study/complete-your-application',
  'https://www.ucas.com/international/international-students/support-for-international-students/tips-for-international-applications',
];
const content = {
 en: 'General study-abroad preparation, not universal requirements: choose a country and program, then check each institution’s current requirements and deadlines. Common application materials can include identity/passport details, previous education certificates and transcripts, translations if requested, and language evidence if required. Some programs request a personal statement, references, tests or a portfolio. Exact documents depend on the country, institution and degree. Check funding and any applicable visa requirements separately. Do not send private documents in this chat.',
 ru: 'Общая подготовка к учёбе за рубежом, а не универсальные требования: выберите страну и программу, затем проверьте актуальные условия и сроки конкретного вуза. Могут понадобиться данные удостоверения личности или паспорта, документы об образовании и оценки, переводы по запросу, подтверждение языка при необходимости. Некоторые программы запрашивают мотивационное письмо, рекомендации, тесты или портфолио. Точный список зависит от страны, вуза и уровня обучения. Финансирование и применимые визовые требования проверяют отдельно. Не отправляйте личные документы в этот чат.',
 uz: 'Chet elda o‘qishga umumiy tayyorgarlik; bu hamma uchun majburiy talablar ro‘yxati emas: mamlakat va dasturni tanlab, universitetning amaldagi talablari va muddatlarini tekshiring. Shaxsni tasdiqlovchi hujjat yoki pasport ma’lumotlari, attestat yoki diplom va baholar, so‘ralsa tarjimalar, zarur bo‘lsa til bilishini tasdiqlash kerak bo‘lishi mumkin. Ayrim dasturlar motivatsion xat, tavsiyanoma, test yoki portfolio so‘raydi. Aniq hujjatlar mamlakat, universitet va ta’lim bosqichiga bog‘liq. Moliyalashtirish va tegishli viza talablari alohida tekshiriladi. Shaxsiy hujjatlarni bu chatga yubormang.',
};
export function generalPreparationReference(language: Language) { return { _id: `public-study-preparation-${language}-v1`, title: 'Public-source general study preparation; not Edmission policy or universal requirements', language, content: content[language], sourceUrls: generalPreparationSources }; }
export function bookingRequested(text: string, history: any[] = []) {
 const normalized = text.toLowerCase().replace(/[’‘ʻʼ`]/g, "'");
 if (/не\s+(?:хочу|надо|нужно|буду)|не\s+запис|don['’]?t want|do not want|not interested|xohlam|istamay|kerak emas|yozilmay|ёзилмай|хоҳлам|истамай|керак эмас/i.test(normalized)) return false;
 if (/what.*need|что.*нуж|каки.*документ|nima.*kerak|qanday.*hujjat|requirements|talablar/i.test(normalized)) return false;
 if (/хочу\s+(?:узнать|понять)|что такое|want to (?:know|learn|understand)|how.*consultation.*work|bilmoqchiman/i.test(normalized) && !/available|slots|свободн|bo'sh/.test(normalized)) return false;
 const target = /consultation|appointment|consulting|консультац|консалт|консулт|встреч|konsalt|konsult|maslahat|uchrashuv|маслаҳат|маслахат|учрашув/;
 const intent = /book|schedule|reserve|want|would like|need|запис|хочу|yozil|yozdir|bron|band|ro'yxat|ёзил|ёздир|брон|банд|рўйхат|xohla|istay|vaqt|available|свободн|время|qachon/;
 if (target.test(normalized) && intent.test(normalized)) return true;
 const previous = [...history].reverse().find(m => m.direction === 'out');
 const previousUser = [...history].reverse().find(m => m.direction === 'in');
 const clarification = /на что|куда.*запис|какую.*(?:встреч|консультац)|what.*book|which.*appointment|nimaga|нимага|qaysi.*(?:uchrash|maslahat|kons)|қайси.*(?:учраш|маслаҳат|конс)/i.test(previous?.text || '');
 if (target.test(normalized) && clarification && /book|schedule|запис|yozil|yozdir|bron|band|ro'yxat|ёзил|ёздир|брон|банд|рўйхат/i.test(previousUser?.text || '')) return true;
 if (/book|schedule|запис|yozil|yozdir|bron|band|ro'yxat|ёзил|ёздир|брон|банд|рўйхат/i.test(normalized) && target.test((previous?.text || '').toLowerCase())) return true;
 const accepted = /^(yes|yes please|sure|okay|ok|да|давайте|хорошо|ha|albatta|mayli)[!.\s]*$/i.test(normalized.trim());
 return Boolean(accepted && previous && /(?:book.*consultation|запис.*консультац|(?:maslahat|konsalt|konsult|uchrashuv).*(?:yozil|bron|band)|(?:yozil|bron|band).*(?:maslahat|konsalt|konsult|uchrashuv))/i.test(previous.text || ''));
}

export function claimsVisibleCalendar(text: string) { return /calendar[\s\S]{0,80}below|below[\s\S]{0,80}calendar|календар[\s\S]{0,80}(?:ниже|пастда|қуйида)|(?:ниже|пастда|қуйида)[\s\S]{0,80}календар|(?:quyida\w*|pastda\w*|tagida\w*)[\s\S]{0,80}(?:taqvim|kalendar)|(?:taqvim|kalendar)[\s\S]{0,80}(?:quyida\w*|pastda\w*|tagida\w*)|(?:тақвим|таквим)[\s\S]{0,80}(?:қуйида|пастда|тагида)|(?:қуйида|пастда|тагида)[\s\S]{0,80}(?:тақвим|таквим)/i.test(text); }
export function safeProactiveOffer(text: string, language: Language) { if(!claimsVisibleCalendar(text))return text;const safe=text.split(/(?<=[.!?])\s+|\n+/).filter(sentence=>!claimsVisibleCalendar(sentence)).join(' ').trim();return safe || (language==='ru'?'Для записи нажмите кнопку ниже.':language==='uz'?'Yozilish uchun quyidagi tugmani bosing.':'Use the button below to choose a consultation time.'); }
