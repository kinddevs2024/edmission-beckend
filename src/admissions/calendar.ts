import { AdmissionSlot, AdmissionState } from './models';
import { Language } from './policy';

export const defaultAvailability = { enabled: true, consultantId: 'admissions-default', consultantName: 'Edmission consultant', startHour: 14, lastStartHour: 18, slotMinutes: 30, monthsAhead: 6, weekdays: [0, 1, 2, 3, 4, 5, 6], closedDates: [] as string[], mode: 'office', location: 'Edmission consultation — our team will confirm the meeting details.' };
export function tashkentDay(date = new Date()) { return new Date(+date + 5 * 3600000).toISOString().slice(0, 10); }
export function monthShift(month: string, delta: number) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7); }
export function monthAllowed(month: string, cfg: any, now = new Date()) {
  const current = tashkentDay(now).slice(0, 7); const count = cfg.availability?.monthsAhead || 6;
  return /^\d{4}-(?:0[1-9]|1[0-2])$/.test(month) && month >= current && month < monthShift(current, count);
}
export function dayDate(day: string, hour = 0, minute = 0) { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, hour - 5, minute)); }
export function dayAllowed(day: string, cfg: any, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !monthAllowed(day.slice(0, 7), cfg, now) || day < tashkentDay(now)) return false;
  if (tashkentDay(dayDate(day)) !== day) return false;
  const availability = { ...defaultAvailability, ...(cfg.availability || {}) };
  return availability.enabled && !availability.closedDates.includes(day) && availability.weekdays.includes(new Date(`${day}T00:00:00Z`).getUTCDay());
}
export function scheduleMinutes(availability: any): number[] {
  const step = availability.slotMinutes === 60 ? 60 : 30;
  const minutes: number[] = [];
  for (let time = availability.startHour * 60; time <= availability.lastStartHour * 60; time += step) minutes.push(time);
  return minutes;
}
export function isScheduledStart(start: Date, availability: any) {
  const local = new Date(+start + 5 * 3600000);
  return local.getUTCSeconds() === 0 && local.getUTCMilliseconds() === 0 && scheduleMinutes(availability).includes(local.getUTCHours() * 60 + local.getUTCMinutes());
}
export async function ensureMonthSlots(month: string, cfg: any, now = new Date()) {
  if (!monthAllowed(month, cfg, now)) return;
  const a = { ...defaultAvailability, ...(cfg.availability || {}) }; if (!a.enabled) return;
  const key = `calendar-lock:${a.consultantId}`;
  await AdmissionState.updateOne({ key }, { $setOnInsert: { value: { until: new Date(0) } } }, { upsert: true });
  const lease = await AdmissionState.findOneAndUpdate({ key, 'value.until': { $lte: new Date() } }, { $set: { 'value.until': new Date(Date.now() + 15000) } }, { new: true });
  if (!lease) throw new Error('CALENDAR_BUSY');
  try {
  const first = dayDate(month + '-01'); const last = dayDate(monthShift(month, 1) + '-01');
  const monthFilter = { consultantId: a.consultantId, start: { $lt: last }, end: { $gt: first } };
  let existing: any[] = await AdmissionSlot.find(monthFilter).select('start end leadId cancelled').lean();
  // Convert only unreserved legacy hourly slots. Confirmed appointments retain their duration.
  if (a.slotMinutes === 30) {
    const legacy = existing.filter(slot => !slot.leadId && !slot.cancelled && +new Date(slot.start) > +now && isScheduledStart(new Date(slot.start), a) && +new Date(slot.end) - +new Date(slot.start) === 3600000);
    if (legacy.length) {
      await AdmissionSlot.bulkWrite(legacy.map(slot => ({ updateOne: { filter: { _id: slot._id, leadId: null, cancelled: false, end: slot.end }, update: { $set: { end: new Date(+new Date(slot.start) + 30 * 60000) } } } })));
      existing = await AdmissionSlot.find(monthFilter).select('start end leadId cancelled').lean();
    }
  }
  const [year, monthNo] = month.split('-').map(Number); const days = new Date(Date.UTC(year, monthNo, 0)).getUTCDate();
  const operations: any[] = [];
  for (let n = 1; n <= days; n++) {
    const day = `${month}-${String(n).padStart(2, '0')}`; if (!dayAllowed(day, cfg, now)) continue;
    for (const minute of scheduleMinutes(a)) {
      const start = dayDate(day, Math.floor(minute / 60), minute % 60); const end = new Date(+start + a.slotMinutes * 60000); if (+start <= +now) continue;
      if (existing.some(slot => +new Date(slot.start) < +end && +new Date(slot.end) > +start)) continue;
      operations.push({ updateOne: { filter: { consultantId: a.consultantId, start }, update: { $setOnInsert: { consultantId: a.consultantId, consultantName: a.consultantName, start, end, mode: a.mode, location: a.location, leadId: null, cancelled: false, attendance: 'pending' } }, upsert: true } });
    }
  }
  if (operations.length) { try { await AdmissionSlot.bulkWrite(operations, { ordered: false }); } catch (error: any) { if (error.code !== 11000 && !error.writeErrors?.every((e: any) => e.code === 11000)) throw error; } }
  } finally { await AdmissionState.updateOne({ key }, { $set: { 'value.until': new Date(0) } }); }
}
export async function availableSlots(month: string, cfg: any, now = new Date()) {
  if (!monthAllowed(month, cfg, now)) return [];
  await ensureMonthSlots(month, cfg, now);
  const a = { ...defaultAvailability, ...(cfg.availability || {}) };
  const slots: any[] = await AdmissionSlot.find({ consultantId: a.consultantId, leadId: null, cancelled: false, start: { $gt: now, $gte: dayDate(month + '-01'), $lt: dayDate(monthShift(month, 1) + '-01') } }).sort({ start: 1 }).lean();
  const booked: any[] = await AdmissionSlot.find({ consultantId: a.consultantId, leadId: { $ne: null }, cancelled: false, start: { $lt: dayDate(monthShift(month, 1) + '-01') }, end: { $gt: dayDate(month + '-01') } }).select('start end').lean();
  return slots.filter(slot => dayAllowed(tashkentDay(new Date(slot.start)), cfg, now) && isScheduledStart(new Date(slot.start), a) && +new Date(slot.end) - +new Date(slot.start) === a.slotMinutes * 60000 && !booked.some(booking => +new Date(booking.start) < +new Date(slot.end) && +new Date(booking.end) > +new Date(slot.start)));

}
export function monthKeyboard(month: string, slots: any[], cfg: any, language: Language, now = new Date()) {
  const locale = language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-GB';
  const days = [...new Set(slots.map(slot => tashkentDay(new Date(slot.start))))];
  const rows: any[][] = [];
  for (let i = 0; i < days.length; i += 5) rows.push(days.slice(i, i + 5).map(day => ({ text: new Intl.DateTimeFormat(locale, { day: 'numeric', weekday: 'short', timeZone: 'Asia/Tashkent' }).format(dayDate(day, 12)), callback_data: `cal:d:${day}` })));
  const navigation = [];
  if (monthAllowed(monthShift(month, -1), cfg, now)) navigation.push({ text: '←', callback_data: `cal:m:${monthShift(month, -1)}` });
  if (monthAllowed(monthShift(month, 1), cfg, now)) navigation.push({ text: '→', callback_data: `cal:m:${monthShift(month, 1)}` });
  if (navigation.length) rows.push(navigation);
  return { title: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'Asia/Tashkent' }).format(dayDate(month + '-01', 12)), days, inline_keyboard: rows };
}
export function hourKeyboard(day: string, slots: any[], language: Language) {
  const available = slots.filter(slot => tashkentDay(new Date(slot.start)) === day);
  const rows: any[][] = [];
  for (let i = 0; i < available.length; i += 3) rows.push(available.slice(i, i + 3).map(slot => ({ text: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tashkent' }).format(new Date(slot.start)), callback_data: `cal:t:${slot._id}` })));
  rows.push([{ text: language === 'ru' ? '← К датам' : language === 'uz' ? '← Sanalarga' : '← Back to dates', callback_data: `cal:m:${day.slice(0, 7)}` }]);
  return { available, inline_keyboard: rows };
}
