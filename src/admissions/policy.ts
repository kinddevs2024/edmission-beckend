export type Language = 'uz' | 'ru' | 'en';
export function detectLanguage(text: string, previous: Language = 'en'): Language {
  if (/^\/(?:ru|uz|en)\b/.test(text)) return text.slice(1, 3) as Language;
  if (/[а-яё]/i.test(text)) return 'ru';
  if (/\b(salom|rahmat|qanday|narx|universitet|o'q|o‘q|oʻq|kerak|men|qabul|bo'l|bo‘l|menga)\b/i.test(text)) return 'uz';
  if (/\b(hello|hi|thanks|what|how|where|university|admission|fee|please|scholarship)\b/i.test(text)) return 'en';
  return previous;
}
export const copy = {
  en: {
    welcome: 'Hello! I am Edmission’s AI admissions assistant. I can answer from approved information and help book a consultation. Please avoid sending passports or bank details. /book — book, /human — consultant, /privacy — privacy, /stop — stop follow-ups. What would you like to study?',
    unknown: 'I don’t have a verified answer to that just yet. We can explore study options together, or open the consultation calendar.',
    human: 'I am your AI admissions assistant. How can I help?',
    resumed: 'Automated support resumed. How can I help?',
    stopped: 'Follow-ups are disabled. You can still message us or use /book.',
    consent: 'Follow-ups are enabled. Use /stop at any time to opt out.',
    privacy: 'We store your Telegram chat ID, messages, details you choose to share, bookings and follow-up history to provide admissions support. Staff can access this information. AI uses Meta after your permission. /external_ai allows conversation text to be processed by Meta if staff enable it; /local_ai revokes permission. /delete deletes data; /stop disables follow-ups. Do not send identity documents here.',
    deleted: 'Your conversation data has been deleted. Future messages start a new conversation.',
    bookName: 'What is your full name? Send /cancel to stop booking.',
    bookPhone: 'What phone number can the consultant use to contact you?',
    bookPurpose: 'What would you like to discuss at the consultation?',
    noSlots: 'No available times in this month. Please choose another month.',
    choose: 'Choose an available consultation time (UTC+5 / Tashkent):',
    booked: 'You’re booked! Here are your consultation details: ✅',
    cancelled: 'The consultation has been cancelled. Use /book to choose a new time.',
    unavailable: 'That time is no longer available. Use /book to choose another slot.',
    paused: 'How can I help you?',
    career: 'If you are unsure about a profession, we can discuss your interests, strengths and goals. This is not a psychological assessment. A career counselor can help with a fuller assessment. What subjects or activities interest you most? Use /book to arrange a consultation.',
  },
  ru: {
    welcome: 'Здравствуйте! Я ИИ-помощник Edmission по поступлению. Отвечаю по проверенной базе и помогаю записаться на консультацию. Не отправляйте паспорта и банковские данные. /book — запись, /human — консультант, /privacy — данные, /stop — отключить напоминания о поступлении. Что хотите изучать?',
    unknown: 'Пока не могу подтвердить эту информацию. Давайте разберёмся с направлением учёбы или посмотрим свободное время для консультации.',
    human: 'Я ИИ-помощник по поступлению. Чем могу помочь?',
    resumed: 'Автоматические ответы включены. Чем помочь?', stopped: 'Повторные обращения отключены. Можно продолжить диалог или записаться через /book.',
    consent: 'Повторные обращения включены. Для отключения отправьте /stop.',
    privacy: 'Для помощи с поступлением сохраняем ID Telegram, сообщения, добровольные данные, записи и историю обращений. Доступ есть у сотрудников. ИИ использует Meta с вашего разрешения. /external_ai разрешает Meta обрабатывать текст диалога, если провайдер включён сотрудником; /local_ai отзывает разрешение. /delete удаляет данные; /stop отключает повторные обращения. Не отправляйте документы личности.',
    deleted: 'История и ваши данные удалены. Новое сообщение начнет новый диалог.',
    bookName: 'Как вас зовут (имя и фамилия)? /cancel отменит запись.', bookPhone: 'Какой номер телефона оставить консультанту?',
    bookPurpose: 'Что хотите обсудить на консультации?', noSlots: 'В этом месяце свободных записей нет. Выберите другой месяц.',
    choose: 'Выберите время консультации (UTC+5 / Ташкент):', booked: 'Готово, вы записаны! Детали консультации: ✅',
    cancelled: 'Запись отменена. Выбрать другое время: /book.', unavailable: 'Это время уже занято. Выберите другое через /book.',
    paused: 'Чем я могу помочь?',
    career: 'Если вы пока не определились с профессией, обсудим интересы, сильные стороны и цели. Это не психологическая диагностика. Для полноценной оценки можно записаться к карьерному консультанту через /book. Какие предметы и занятия вам интересны?',
  },
  uz: {
    welcome: 'Salom! Men Edmission qabul bo‘yicha AI yordamchisiman. Tasdiqlangan ma’lumotlar asosida javob beraman va maslahatga yozaman. Pasport yoki bank ma’lumotlarini yubormang. /book — yozilish, /human — maslahatchi, /privacy — maxfiylik, /stop — keyingi xabarlarni o‘chirish. Nimani o‘rganmoqchisiz?',
    unknown: 'Bu ma’lumotni hozircha tasdiqlay olmayman. Keling, o‘qish yo‘nalishlarini ko‘rib chiqamiz yoki maslahat uchun bo‘sh vaqtni tanlaymiz.',
    human: 'Men qabul bo‘yicha AI yordamchiman. Qanday yordam bera olaman?',
    resumed: 'Avtomatik yordam yoqildi. Qanday yordam bera olaman?', stopped: 'Keyingi taklif xabarlari o‘chirildi. /book orqali yozilishingiz mumkin.',
    consent: 'Keyingi taklif xabarlari yoqildi. O‘chirish uchun /stop yozing.',
    privacy: 'Qabul uchun Telegram ID, xabarlar, ixtiyoriy ma’lumotlar, uchrashuv va murojaatlarni saqlaymiz. Xodimlar ko‘rishi mumkin. AI roziligingiz bilan Meta orqali ishlaydi. /external_ai suhbat matnini Meta orqali qayta ishlashga ruxsat beradi (administrator yoqqan bo‘lsa); /local_ai ruxsatni bekor qiladi. /delete ma’lumotlarni o‘chiradi; /stop keyingi xabarlarni to‘xtatadi. Shaxsiy hujjat yubormang.',
    deleted: 'Sizning ma’lumotlaringiz va suhbat tarixi o‘chirildi. Yangi xabar yangi suhbatni boshlaydi.',
    bookName: 'Ism va familiyangiz? Yozilishni to‘xtatish: /cancel.', bookPhone: 'Maslahatchi bog‘lanishi uchun telefon raqamingiz?',
    bookPurpose: 'Maslahatda nimani muhokama qilmoqchisiz?', noSlots: 'Bu oyda bo‘sh vaqt yo‘q. Boshqa oyni tanlang.',
    choose: 'Maslahat vaqtini tanlang (UTC+5 / Toshkent):', booked: 'Tayyor, yozildingiz! Maslahat tafsilotlari: ✅',
    cancelled: 'Uchrashuv bekor qilindi. Yangi vaqt: /book.', unavailable: 'Bu vaqt band bo‘ldi. /book orqali boshqasini tanlang.',
    paused: 'Qanday yordam bera olaman?',
    career: 'Kasb tanlamagan bo‘lsangiz, qiziqishlar, kuchli tomonlar va maqsadlarni muhokama qilamiz. Bu psixologik tashxis emas. To‘liqroq baholash uchun /book orqali mutaxassisga yoziling. Qaysi fan va mashg‘ulotlar sizga yoqadi?',
  },
};
export function terms(text: string): string[] {
  const stop = new Set(['what', 'where', 'when', 'your', 'have', 'about', 'please', 'with', 'this', 'that', 'как', 'что', 'для', 'мне', 'это', 'есть', 'какие', 'можно', 'the', 'and']);
  return [...new Set(text.toLocaleLowerCase().replace(/[’‘ʻ']/g, '').match(/[\p{L}\p{N}']{3,}/gu) || [])].filter(t => !stop.has(t));
}
export function rankKnowledge(query: string, entries: any[]): any[] {
  const words = terms(query);
  return entries.map(entry => {
    const title = String(entry.title).toLowerCase().replace(/[’‘ʻ']/g, '');
    const content = `${entry.category} ${entry.content}`.toLowerCase().replace(/[’‘ʻ']/g, '');
    const score = words.reduce((sum, word) => sum + (title.includes(word) ? 4 : content.includes(word) ? 1 : 0), 0);
    return { entry, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(x => x.entry);
}
export function scoreLead(text: string, profile: Record<string, unknown> = {}) {
  const booking = /\b(book|appointment|consultation|apply now)\b|запис|консультац|поступать|maslahat|yozil/i.test(text);
  const career = /don't know|not sure.*(?:study|career)|не знаю.*(?:профес|учить)|касб|kasb/i.test(text);
  const objections = [/(?:expensive|budget|fee|дорог|бюджет|narx)/i.test(text) ? 'budget' : '', /parent|родител|ota.on/i.test(text) ? 'parents' : '', /think|uncertain|подума|не уверен|o‘ylab|o'ylab/i.test(text) ? 'considering' : ''].filter(Boolean);
  const score = Math.min(100, Object.keys(profile).filter(k => profile[k]).length * 8 + (booking ? 45 : 0));
  return { score, intent: career ? 'career_guidance' : booking ? 'consultation' : 'information', objections, nextAction: booking ? 'Offer consultation slots' : career ? 'Offer career counselor' : 'Answer verified questions and qualify gently' };
}
export function formatSlot(slot: any, language: Language) {
  return `${new Intl.DateTimeFormat(language === 'uz' ? 'uz-UZ' : language === 'ru' ? 'ru-RU' : 'en-GB', { timeZone: 'Asia/Tashkent', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(slot.start))} — ${slot.consultantName}\n${slot.mode === 'online' ? 'Online' : 'Office'}: ${slot.location}`;
}
export function canFollowUp(lead: any, job: any): boolean {
  return Boolean(lead && lead.followupConsent && !lead.aiPaused && !['not_interested', 'on_hold', 'closed', 'enrolled'].includes(lead.status) && (!lead.lastInboundAt || new Date(lead.lastInboundAt).getTime() <= new Date(job.inboundVersion || job.createdAt).getTime()));
}
