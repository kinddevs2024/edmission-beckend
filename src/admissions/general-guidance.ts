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
 const normalized = text.toLowerCase().replace(/[’‘ʻ‘]/g, "'");
 const consultation = /consultation|appointment|консультац|maslahat/.test(normalized);
 const request = /book|schedule|reserve|want|would like|need|запис|хочу|yozil|band qil|xohla|istay|vaqt|available|свободн|время|qachon/.test(normalized);
 if (consultation && request) return true;
 const accepted = /^(yes|yes please|sure|okay|ok|да|давайте|хорошо|ha|albatta|mayli)[!.\s]*$/i.test(normalized.trim());
 const previous = [...history].reverse().find(m => m.direction === 'out');
 return Boolean(accepted && previous && /(?:book.*consultation|запис.*консультац|maslahat.*yozil)/i.test(previous.text || ''));
}
