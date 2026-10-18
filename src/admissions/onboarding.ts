import { mainMenu } from './menu';
import { Language } from './policy';

export const intakeCopy = {
  en: { intro: 'Hello! I’m Edmission’s virtual admissions assistant. I can help with study destinations, universities, programs and consultation booking using information approved by our team. I will explain clearly when information is not yet verified.', name: 'What is your name?', phone: 'Share your phone number or type it with its country code. Continuing enables Meta AI for your chat.', share: 'Share my phone number', human: 'Talk to a consultant', help: 'How can I help you?', badName: 'Please enter your name using letters (2–120 characters).', badPhone: 'Please enter a valid phone number with country code, for example +998901234567, or use the share button.' },
  ru: { intro: 'Здравствуйте! Я виртуальный помощник Edmission по поступлению. Помогаю с выбором страны, вопросами об университетах и программах и записью на консультацию по проверенной информации команды. Если информация не подтверждена, я прямо об этом скажу.', name: 'Как вас зовут?', phone: 'Поделитесь номером телефона или введите его с кодом страны. Продолжая, вы разрешаете обработку диалога Meta AI.', share: 'Поделиться номером телефона', human: 'Связаться с консультантом', help: 'Чем я могу вам помочь?', badName: 'Введите имя буквами (от 2 до 120 символов).', badPhone: 'Введите действительный номер с кодом страны, например +998901234567, или нажмите кнопку отправки номера.' },
  uz: { intro: 'Salom! Men Edmission’ning qabul bo‘yicha virtual yordamchisiman. Jamoamiz tasdiqlagan ma’lumotlar asosida o‘qish mamlakati, universitet, dastur va maslahatga yozilish bo‘yicha yordam beraman. Ma’lumot tasdiqlanmagan bo‘lsa, buni aniq aytaman.', name: 'Ismingiz nima?', phone: 'Telefon raqamingizni ulashing yoki mamlakat kodi bilan yozing. Davom etsangiz, suhbat Meta AI orqali qayta ishlanadi.', share: 'Telefon raqamimni ulashish', human: 'Maslahatchi bilan bog‘lanish', help: 'Sizga qanday yordam bera olaman?', badName: 'Ismingizni harflar bilan yozing (2–120 belgi).', badPhone: 'Mamlakat kodi bilan to‘g‘ri raqam kiriting, masalan +998901234567, yoki raqamni ulashish tugmasini bosing.' },
};
export function normalizePhone(value: string): string | null {
  if (!/^\+?[\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  return /^[1-9]\d{6,14}$/.test(digits) ? `+${digits}` : null;
}
export function validName(value: string) { return value.length >= 2 && value.length <= 120 && /^[\p{L}\p{M}\s.'’ʻ-]+$/u.test(value) && (value.match(/\p{L}/gu) || []).length >= 2; }
type Send = (lead: any, text: string, options?: Record<string, unknown>) => Promise<any>;
export async function languagePicker(lead: any, send: Send) {
  return send(lead, 'Choose your language / Выберите язык / Tilni tanlang', { reply_markup: { inline_keyboard: [[{ text: 'English', callback_data: 'lang:en' }], [{ text: 'Русский', callback_data: 'lang:ru' }], [{ text: 'O‘zbekcha', callback_data: 'lang:uz' }]] } });
}
export async function askIntake(lead: any, send: Send) {
  const c = intakeCopy[lead.language as Language];
  if (lead.onboardingStage === 'language') return languagePicker(lead, send);
  if (lead.onboardingStage === 'name') return send(lead, c.name, { reply_markup: { remove_keyboard: true } });
  if (lead.onboardingStage === 'phone') return send(lead, c.phone, { reply_markup: { keyboard: [[{ text: c.share, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
  return send(lead, c.help, { reply_markup: mainMenu(lead.language) });
}
export async function handleOnboarding(lead: any, text: string, update: any, send: Send): Promise<boolean> {
  // Existing, fully supplied CRM profiles are preserved during this release.
  if (!lead.onboardingVersion && lead.name && normalizePhone(lead.phone || '')) {
    lead.onboardingStage = 'complete'; lead.nameConfirmed = true; lead.phoneConfirmed = true;
    lead.onboardedAt = lead.onboardedAt || new Date(); lead.onboardingVersion = 1; await lead.save();
  }
  const chosen = /^(?:lang:|\/)(en|ru|uz)\b/.exec(text)?.[1] as Language | undefined;
  if (chosen) {
    lead.language = chosen; lead.languageExplicit = true; lead.onboardingVersion = 1;
    if (!lead.nameConfirmed) lead.onboardingStage = 'name';
    else if (!lead.phoneConfirmed) lead.onboardingStage = 'phone';
    else lead.onboardingStage = 'complete';
    await lead.save();
    await send(lead, intakeCopy[chosen].intro); // Deliberately separate from the next question.
    await askIntake(lead, send); return true;
  }
  if (/^\/start\b/.test(text)) {
    if (lead.onboardingStage === 'complete') await languagePicker(lead, send);
    else await askIntake(lead, send);
    return true;
  }
  if (/^\/(?:privacy|delete|stop|human|resume|external_ai|local_ai)\b/.test(text)) return false;
  if (Object.values(intakeCopy).some(c => c.human === text)) return false;
  if (lead.onboardingStage === 'complete') return false;
  const c = intakeCopy[lead.language as Language];
  if (lead.onboardingStage === 'language') { await languagePicker(lead, send); return true; }
  if (lead.onboardingStage === 'name') {
    if (!validName(text)) { await send(lead, c.badName); return true; }
    lead.name = text.trim(); lead.nameConfirmed = true; lead.onboardingStage = 'phone'; await lead.save(); await askIntake(lead, send); return true;
  }
  if (lead.onboardingStage === 'phone') {
    if (update.message?.contact?.user_id && String(update.message.contact.user_id) !== String(update.message.from?.id)) { await send(lead, c.badPhone); return true; }
    const phone = normalizePhone(text); if (!phone) { await send(lead, c.badPhone); return true; }
    lead.phone = phone; lead.phoneConfirmed = true; lead.onboardingStage = 'complete'; lead.onboardingVersion = 1; lead.onboardedAt = new Date();
    lead.externalAIConsent = true; lead.externalAIConsentAt = new Date(); lead.consentVersion = 'meta-intake-1';
    await lead.save(); await askIntake(lead, send); return true;
  }
  return false;
}
