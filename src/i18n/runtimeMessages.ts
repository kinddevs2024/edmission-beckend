import { type ApiLocale, translateApiText } from './apiMessages';

type LocalizedText = Record<ApiLocale, string>;
type RegexHandler = (match: RegExpMatchArray, locale: ApiLocale) => string;

const statusLabels: Record<string, LocalizedText> = {
  interested: { en: 'interested', ru: 'заинтересована', uz: 'qiziqmoqda' },
  under_review: { en: 'under review', ru: 'на рассмотрении', uz: "ko'rib chiqilmoqda" },
  chat_opened: { en: 'chat opened', ru: 'чат открыт', uz: 'chat ochilgan' },
  offer_sent: { en: 'offer sent', ru: 'оффер отправлен', uz: 'taklif yuborilgan' },
  accepted: { en: 'accepted', ru: 'принята', uz: 'qabul qilindi' },
  rejected: { en: 'rejected', ru: 'отклонена', uz: 'rad etildi' },
};

const documentTypeLabels: Record<string, LocalizedText> = {
  offer: { en: 'offer', ru: 'оффер', uz: 'taklif' },
  scholarship: { en: 'scholarship', ru: 'стипендия', uz: 'stipendiya' },
  document: { en: 'document', ru: 'документ', uz: 'hujjat' },
};

const exactMessages: Record<string, LocalizedText> = {
  'New message': { en: 'New message', ru: 'Новое сообщение', uz: 'Yangi xabar' },
  'Chat opened': { en: 'Chat opened', ru: 'Чат открыт', uz: 'Chat ochildi' },
  'You have been accepted!': { en: 'You have been accepted!', ru: 'Вас приняли!', uz: 'Siz qabul qilindingiz!' },
  'University account approved': {
    en: 'University account approved',
    ru: 'Аккаунт университета подтвержден',
    uz: 'Universitet akkaunti tasdiqlandi',
  },
  'New interest': { en: 'New interest', ru: 'Новый интерес', uz: 'Yangi qiziqish' },
  'New interest (catalog)': {
    en: 'New interest (catalog)',
    ru: 'Новый интерес (каталог)',
    uz: 'Yangi qiziqish (katalog)',
  },
  'Offer accepted': { en: 'Offer accepted', ru: 'Оффер принят', uz: 'Taklif qabul qilindi' },
  'Offer declined': { en: 'Offer declined', ru: 'Оффер отклонен', uz: 'Taklif rad etildi' },
  'Offer expired': { en: 'Offer expired', ru: 'Срок оффера истек', uz: 'Taklif muddati tugadi' },
  'New offer': { en: 'New offer', ru: 'Новый оффер', uz: 'Yangi taklif' },
  'Application status updated': {
    en: 'Application status updated',
    ru: 'Статус заявки обновлен',
    uz: 'Ariza holati yangilandi',
  },
  'Document viewed': { en: 'Document viewed', ru: 'Документ просмотрен', uz: "Hujjat ko'rildi" },
  'Document accepted': { en: 'Document accepted', ru: 'Документ принят', uz: 'Hujjat qabul qilindi' },
  'Document declined': { en: 'Document declined', ru: 'Документ отклонен', uz: 'Hujjat rad etildi' },
  'Decision postponed': { en: 'Decision postponed', ru: 'Решение отложено', uz: 'Qaror kechiktirildi' },
  'Document revoked': { en: 'Document revoked', ru: 'Документ отозван', uz: 'Hujjat bekor qilindi' },
  'Document expired': { en: 'Document expired', ru: 'Срок документа истек', uz: 'Hujjat muddati tugadi' },
  'Join request': { en: 'Join request', ru: 'Запрос на присоединение', uz: "Qo'shilish so'rovi" },
  'Accepted to school': { en: 'Accepted to school', ru: 'Принят в школу', uz: 'Maktabga qabul qilindi' },
  'School invitation': { en: 'School invitation', ru: 'Приглашение в школу', uz: 'Maktab taklifi' },
  'Invitation accepted': { en: 'Invitation accepted', ru: 'Приглашение принято', uz: 'Taklif qabul qilindi' },
  'Invitation declined': { en: 'Invitation declined', ru: 'Приглашение отклонено', uz: 'Taklif rad etildi' },
  'University verification request': {
    en: 'University verification request',
    ru: 'Запрос на подтверждение университета',
    uz: "Universitetni tasdiqlash so'rovi",
  },
  'You received an Offer': { en: 'You received an Offer', ru: 'Вы получили оффер', uz: 'Siz taklif oldingiz' },
  'You received a Scholarship': {
    en: 'You received a Scholarship',
    ru: 'Вы получили стипендию',
    uz: 'Siz stipendiya oldingiz',
  },
  'Your request to join the school was accepted': {
    en: 'Your request to join the school was accepted',
    ru: 'Ваш запрос на присоединение к школе принят',
    uz: "Maktabga qo'shilish so'rovingiz qabul qilindi",
  },
  'Offer expired without student decision.': {
    en: 'Offer expired without student decision.',
    ru: 'Срок оффера истек без решения студента.',
    uz: 'Taklif muddati talaba qarorisiz tugadi.',
  },
  'Student accepted the document.': {
    en: 'Student accepted the document.',
    ru: 'Студент принял документ.',
    uz: 'Talaba hujjatni qabul qildi.',
  },
  'Student declined the document.': {
    en: 'Student declined the document.',
    ru: 'Студент отклонил документ.',
    uz: 'Talaba hujjatni rad etdi.',
  },
  'Student viewed the document': {
    en: 'Student viewed the document',
    ru: 'Студент просмотрел документ',
    uz: "Talaba hujjatni ko'rdi",
  },
  'Voice message': { en: 'Voice message', ru: 'Голосовое сообщение', uz: 'Ovozli xabar' },
  Reaction: { en: 'Reaction', ru: 'Реакция', uz: 'Reaksiya' },
  'Student accepted the offer': {
    en: 'Student accepted the offer',
    ru: 'Студент принял оффер',
    uz: 'Talaba taklifni qabul qildi',
  },
  'Student declined the scholarship': {
    en: 'Student declined the scholarship',
    ru: 'Студент отклонил стипендию',
    uz: 'Talaba stipendiyani rad etdi',
  },
  'Offer revoked': { en: 'Offer revoked', ru: 'Оффер отозван', uz: 'Taklif bekor qilindi' },
  'Scholarship revoked': { en: 'Scholarship revoked', ru: 'Стипендия отозвана', uz: 'Stipendiya bekor qilindi' },
};

const regexMessages: Array<{ pattern: RegExp; handler: RegexHandler }> = [
  {
    pattern: /^(.+) is interested in your university$/,
    handler: (match, locale) => {
      const studentName = match[1];
      if (locale === 'ru') return `${studentName} заинтересовался вашим университетом`;
      if (locale === 'uz') return `${studentName} sizning universitetingizga qiziqmoqda`;
      return `${studentName} is interested in your university`;
    },
  },
  {
    pattern: /^(.+) is interested in (.+) \(template\)$/,
    handler: (match, locale) => {
      const studentName = match[1];
      const catalogName = match[2];
      if (locale === 'ru') return `${studentName} заинтересовался ${catalogName} (шаблон)`;
      if (locale === 'uz') return `${studentName} ${catalogName} ga qiziqmoqda (shablon)`;
      return `${studentName} is interested in ${catalogName} (template)`;
    },
  },
  {
    pattern: /^(.+) accepted your offer$/,
    handler: (match, locale) => {
      const studentName = match[1];
      if (locale === 'ru') return `${studentName} принял ваш оффер`;
      if (locale === 'uz') return `${studentName} sizning taklifingizni qabul qildi`;
      return `${studentName} accepted your offer`;
    },
  },
  {
    pattern: /^(.+) declined your offer$/,
    handler: (match, locale) => {
      const studentName = match[1];
      if (locale === 'ru') return `${studentName} отклонил ваш оффер`;
      if (locale === 'uz') return `${studentName} sizning taklifingizni rad etdi`;
      return `${studentName} declined your offer`;
    },
  },
  {
    pattern: /^(.+) updated your application status to (.+)$/,
    handler: (match, locale) => {
      const universityName = match[1];
      const status = translateStatus(match[2], locale);
      if (locale === 'ru') return `${universityName} обновил статус вашей заявки на ${status}`;
      if (locale === 'uz') return `${universityName} arizangiz holatini ${status} ga yangiladi`;
      return `${universityName} updated your application status to ${status}`;
    },
  },
  {
    pattern: /^You have received an offer from (.+)$/,
    handler: (match, locale) => {
      const universityName = match[1];
      if (locale === 'ru') return `Вы получили оффер от ${universityName}`;
      if (locale === 'uz') return `Siz ${universityName} dan taklif oldingiz`;
      return `You have received an offer from ${universityName}`;
    },
  },
  {
    pattern: /^Offer from (.+) has expired\.$/,
    handler: (match, locale) => {
      const universityName = match[1];
      if (locale === 'ru') return `Срок оффера от ${universityName} истек.`;
      if (locale === 'uz') return `${universityName} dan taklif muddati tugadi.`;
      return `Offer from ${universityName} has expired.`;
    },
  },
  {
    pattern: /Voice message$/,
    handler: (_match, locale) => {
      if (locale === 'ru') return 'Голосовое сообщение';
      if (locale === 'uz') return 'Ovozli xabar';
      return 'Voice message';
    },
  },
  {
    pattern: /^(.+) viewed the document\.$/,
    handler: (match, locale) => {
      const studentName = match[1];
      if (locale === 'ru') return `${studentName} просмотрел документ.`;
      if (locale === 'uz') return `${studentName} hujjatni ko'rdi.`;
      return `${studentName} viewed the document.`;
    },
  },
  {
    pattern: /^Student postponed the decision until (\d{4}-\d{2}-\d{2})\.$/,
    handler: (match, locale) => {
      const date = match[1];
      if (locale === 'ru') return `Студент отложил решение до ${date}.`;
      if (locale === 'uz') return `Talaba qarorni ${date} gacha kechiktirdi.`;
      return `Student postponed the decision until ${date}.`;
    },
  },
  {
    pattern: /^A university revoked your (.+)\.$/,
    handler: (match, locale) => {
      const documentType = translateDocumentType(match[1], locale);
      if (locale === 'ru') return `Университет отозвал ваш ${documentType}.`;
      if (locale === 'uz') return `Universitet sizning ${documentType}ingizni bekor qildi.`;
      return `A university revoked your ${documentType}.`;
    },
  },
  {
    pattern: /^Your (.+) expired without a decision\.$/,
    handler: (match, locale) => {
      const documentType = translateDocumentType(match[1], locale);
      if (locale === 'ru') return `Срок вашего ${documentType} истек без решения.`;
      if (locale === 'uz') return `Sizning ${documentType}ingiz muddati qarorsiz tugadi.`;
      return `Your ${documentType} expired without a decision.`;
    },
  },
  {
    pattern: /^A (.+) expired without student decision\.$/,
    handler: (match, locale) => {
      const documentType = translateDocumentType(match[1], locale);
      if (locale === 'ru') return `Срок ${documentType} истек без решения студента.`;
      if (locale === 'uz') return `${documentType} muddati talaba qarorisiz tugadi.`;
      return `A ${documentType} expired without student decision.`;
    },
  },
  {
    pattern: /^(.+) invited you to join\. You can accept or decline\.$/,
    handler: (match, locale) => {
      const schoolName = match[1];
      if (locale === 'ru') return `${schoolName} пригласил вас присоединиться. Вы можете принять или отклонить приглашение.`;
      if (locale === 'uz') return `${schoolName} sizni qo'shilishga taklif qildi. Siz qabul qilishingiz yoki rad etishingiz mumkin.`;
      return `${schoolName} invited you to join. You can accept or decline.`;
    },
  },
  {
    pattern: /^(.+) accepted your invitation to join (.+)\.$/,
    handler: (match, locale) => {
      const studentName = match[1];
      const schoolName = match[2];
      if (locale === 'ru') return `${studentName} принял ваше приглашение присоединиться к ${schoolName}.`;
      if (locale === 'uz') return `${studentName} ${schoolName} ga qo'shilish taklifingizni qabul qildi.`;
      return `${studentName} accepted your invitation to join ${schoolName}.`;
    },
  },
  {
    pattern: /^(.+) declined your invitation to join (.+)\.$/,
    handler: (match, locale) => {
      const studentName = match[1];
      const schoolName = match[2];
      if (locale === 'ru') return `${studentName} отклонил ваше приглашение присоединиться к ${schoolName}.`;
      if (locale === 'uz') return `${studentName} ${schoolName} ga qo'shilish taklifingizni rad etdi.`;
      return `${studentName} declined your invitation to join ${schoolName}.`;
    },
  },
  {
    pattern: /^Your request for (.+) has been approved\. You can now sign in and complete your profile\.$/,
    handler: (match, locale) => {
      const universityName = match[1];
      if (locale === 'ru') {
        return `Ваша заявка для ${universityName} одобрена. Теперь вы можете войти и завершить профиль.`;
      }
      if (locale === 'uz') {
        return `${universityName} uchun so'rovingiz tasdiqlandi. Endi tizimga kirib profilingizni to'ldirishingiz mumkin.`;
      }
      return `Your request for ${universityName} has been approved. You can now sign in and complete your profile.`;
    },
  },
  {
    pattern: /^A student requested to join (.+)$/,
    handler: (match, locale) => {
      const schoolName = match[1];
      if (locale === 'ru') return `Студент запросил присоединение к ${schoolName}`;
      if (locale === 'uz') return `Talaba ${schoolName} ga qo'shilish so'rovini yubordi`;
      return `A student requested to join ${schoolName}`;
    },
  },
  {
    pattern: /^Your request for (.+) has been approved\. You can now sign in and complete your profile\.$/,
    handler: (match, locale) => {
      const universityName = match[1];
      if (locale === 'ru') return `Ваш запрос для ${universityName} одобрен. Теперь вы можете войти и заполнить профиль.`;
      if (locale === 'uz') return `${universityName} uchun so'rovingiz tasdiqlandi. Endi tizimga kirib profilingizni to'ldirishingiz mumkin.`;
      return `Your request for ${universityName} has been approved. You can now sign in and complete your profile.`;
    },
  },
  {
    pattern: /^(.+) opened the chat and you can now communicate with them\.$/,
    handler: (match, locale) => {
      const universityName = match[1];
      if (locale === 'ru') return `${universityName} открыл чат, и теперь вы можете общаться с ним.`;
      if (locale === 'uz') return `${universityName} chatni ochdi va endi siz ular bilan muloqot qilishingiz mumkin.`;
      return `${universityName} opened the chat and you can now communicate with them.`;
    },
  },
  {
    pattern: /^The university has accepted you for: (.+)\. Congratulations!$/,
    handler: (match, locale) => {
      const position = match[1];
      if (locale === 'ru') return `Университет принял вас на позицию: ${position}. Поздравляем!`;
      if (locale === 'uz') return `Universitet sizni quyidagi yo'nalishga qabul qildi: ${position}. Tabriklaymiz!`;
      return `The university has accepted you for: ${position}. Congratulations!`;
    },
  },
  {
    pattern: /^(.+) sent you a new (.+)\.$/,
    handler: (match, locale) => {
      const universityName = match[1];
      const documentType = translateDocumentType(match[2], locale);
      if (locale === 'ru') return `${universityName} отправил вам новый ${documentType}.`;
      if (locale === 'uz') return `${universityName} sizga yangi ${documentType} yubordi.`;
      return `${universityName} sent you a new ${documentType}.`;
    },
  },
  {
    pattern: /^New university "(.+)" has submitted an application for "(.+)"\. Review in Admin → University requests\.$/,
    handler: (match, locale) => {
      const applicant = match[1];
      const universityName = match[2];
      if (locale === 'ru') {
        return `Новый университет "${applicant}" подал заявку для "${universityName}". Проверьте ее в Админ → Запросы университетов.`;
      }
      if (locale === 'uz') {
        return `Yangi universitet "${applicant}" "${universityName}" uchun ariza yubordi. Uni Admin → Universitet so'rovlari bo'limida ko'rib chiqing.`;
      }
      return `New university "${applicant}" has submitted an application for "${universityName}". Review in Admin → University requests.`;
    },
  },
];

function translateStatus(status: string, locale: ApiLocale): string {
  return statusLabels[status]?.[locale] ?? status.replace(/_/g, ' ');
}

function translateDocumentType(type: string, locale: ApiLocale): string {
  return documentTypeLabels[type]?.[locale] ?? type.replace(/_/g, ' ');
}

export function translateRuntimeText(message: string, locale: ApiLocale): string {
  const normalized = String(message ?? '').trim();
  if (!normalized) return normalized;

  const apiTranslated = translateApiText(normalized, locale).text;
  if (apiTranslated !== normalized) {
    return apiTranslated;
  }

  const exact = exactMessages[normalized];
  if (exact) {
    return exact[locale];
  }

  for (const entry of regexMessages) {
    const match = normalized.match(entry.pattern);
    if (match) {
      return entry.handler(match, locale);
    }
  }

  return normalized;
}
