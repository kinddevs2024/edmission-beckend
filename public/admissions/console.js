/* No student data or AI output is inserted as HTML. All dynamic text uses textContent. */
(() => {
  'use strict';
  let token = sessionStorage.getItem('admissions_staff_token') || localStorage.getItem('auth_accessToken') || '';
  let tab = 'Overview'; let selectedLead = ''; let leadData; let config;
  const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let analyticsFrom = localDay(new Date(Date.now() - 30 * 86400000)); let analyticsTo = localDay(new Date());
  const $ = s => document.querySelector(s);
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (cls) node.className = cls; return node; };
  const append = (parent, ...children) => { children.forEach(child => parent.append(child)); return parent; };
  const button = (text, action, cls = '') => { const b = el('button', text, cls); b.type = 'button'; b.onclick = () => Promise.resolve(action()).catch(showError); return b; };
  const card = title => { const c = el('div', null, 'card'); if (title) c.append(el('h2', title)); return c; };
  const field = (form, label, name, value = '', type = 'text') => {
    form.append(el('label', label)); const node = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') node.type = type; node.name = name;
    if (type === 'checkbox') node.checked = Boolean(value); else node.value = value == null ? '' : value;
    form.append(node); return node;
  };
  const select = (form, label, name, values, current) => { form.append(el('label', label)); const node = el('select'); node.name = name; for (const value of values) { const option = el('option', value); option.value = value; node.append(option); } node.value = current; form.append(node); return node; };
  const date = value => value ? new Date(value).toLocaleString() : '—';
  const message = text => { $('#toast').textContent = text; $('#toast').classList.remove('hidden'); setTimeout(() => $('#toast').classList.add('hidden'), 3500); };
  function showError(error) { const target = token ? $('#error') : $('#loginerror'); target.textContent = error.message || 'Operation failed'; target.className = 'error'; }
  async function api(path, options = {}) {
    const response = await fetch('/api/admissions' + path, { credentials: 'same-origin', ...options, headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), Authorization: 'Bearer ' + token, ...(options.headers || {}) } });
    if (response.status === 401) { sessionStorage.removeItem('admissions_staff_token'); token = ''; showLogin(); throw new Error('Please sign in again.'); }
    const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || data.error || data.message || 'Request failed'); return data;
  }
  const post = (path, data, method = 'POST') => api(path, { method, body: JSON.stringify(data) });
  function showLogin() { $('#login').classList.remove('hidden'); $('#workspace').classList.add('hidden'); $('#logout').classList.add('hidden'); }
  function modal(title, content) { $('#dialogtitle').textContent = title; $('#dialogbody').replaceChildren(content); $('#dialog').showModal(); }
  $('#closedialog').onclick = () => $('#dialog').close();
  $('#logout').onclick = () => { token = ''; sessionStorage.removeItem('admissions_staff_token'); showLogin(); };
  $('#loginform').onsubmit = async event => {
    event.preventDefault(); const form = new FormData(event.target);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
      const result = await response.json(); event.target.password.value = '';
      if (!response.ok || !result.accessToken) throw new Error(result.requiresTwoFactor ? 'Complete two-factor sign in on the platform, then reopen this page.' : result.error?.message || result.message || 'Sign in failed.');
      token = result.accessToken; sessionStorage.setItem('admissions_staff_token', token); await load();
    } catch (error) { showError(error); }
  };
  async function load() {
    $('#error').textContent = ''; $('#error').className = '';
    if (!token) { showLogin(); return; }
    $('#login').classList.add('hidden'); $('#workspace').classList.remove('hidden'); $('#logout').classList.remove('hidden');
    $('#nav').replaceChildren(...['Overview', 'Conversations', 'Knowledge base', 'Calendar', 'Automation', 'Events'].map(name => button(name, async () => { tab = name; await load(); }, name === tab ? 'active' : '')));
    const view = $('#view'); view.replaceChildren(el('p', 'Loading…', 'muted'));
    if (tab === 'Overview') await overview(view);
    if (tab === 'Conversations') await conversations(view);
    if (tab === 'Knowledge base') await knowledge(view);
    if (tab === 'Calendar') await calendar(view);
    if (tab === 'Automation') await automation(view);
    if (tab === 'Events') await events(view);
  }
  async function overview(view) {
    const start = new Date(analyticsFrom + 'T00:00:00'); const end = new Date(analyticsTo + 'T00:00:00'); end.setDate(end.getDate() + 1);
    const [data, metrics] = await Promise.all([api('/overview'), api('/analytics?from=' + encodeURIComponent(start.toISOString()) + '&to=' + encodeURIComponent(end.toISOString()))]);
    const filters = card('Performance period'); const filterForm = el('form', null, 'row');
    const from = field(filterForm, 'From (your local date)', 'from', analyticsFrom, 'date'); from.style.maxWidth = '190px';
    const to = field(filterForm, 'Through (your local date)', 'to', analyticsTo, 'date'); to.style.maxWidth = '190px';
    filterForm.append(button('Apply dates', async () => { if (!from.value || !to.value || from.value > to.value) throw new Error('Choose a valid date range'); analyticsFrom = from.value; analyticsTo = to.value; await load(); })); filters.append(filterForm);
    filters.append(el('p', `Measurement began ${date(metrics.range.trackingStartedAt)}. Outcomes observed through ${date(metrics.range.asOf)}. Earlier milestones are not reconstructed from current statuses. Deleted personal records are excluded.`, 'muted'));
    const rate = metric => metric.percent == null ? 'n/a' : `${metric.percent}%`;
    const fraction = metric => `${metric.numerator} / ${metric.denominator}`;
    const grid = el('div', null, 'grid');
    for (const [label, value, note] of [
      ['New leads', metrics.activity.newLeads, 'First contacted in this period'], ['Incoming messages', metrics.activity.incomingMessages, `${metrics.activity.trackedInquiries} tracked non-command inquiries`],
      ['Consultations booked', metrics.activity.trackedBookings, 'Recorded booking receipts in this period'], ['AI-answered inquiries', metrics.inquiries.aiAnswered, 'Delivered answers with approved sources; not a satisfaction claim'],
      ['Resolved by student feedback', metrics.inquiries.studentConfirmedResolved, 'Student explicitly selected Helpful'], ['Human handover requests', metrics.inquiries.handovers, 'Includes explicit consultant commands'],
      ['Reminder delivery', rate(metrics.reminders.delivered), fraction(metrics.reminders.delivered) + ' due reminders · cancellations excluded'],
      ['Follow-up response (7 days)', rate(metrics.followups.responseRate7Days), fraction(metrics.followups.responseRate7Days) + ` closed windows · ${metrics.followups.pendingObservation} still observing`],
      ['Recorded attendance', rate(metrics.attendance.recordedRate), fraction(metrics.attendance.recordedRate) + ` attended / attended+missed · ${metrics.attendance.counts.pending || 0} unrecorded`],
      ['Average first reply', metrics.latency.averageMs == null ? 'n/a' : `${(metrics.latency.averageMs / 1000).toFixed(2)}s`, `${metrics.latency.replies} first delivered replies · includes commands`],
    ]) { const c = card(); append(c, el('div', String(value), 'stat'), el('p', label), el('small', note)); grid.append(c); }
    const integrations = card('Integrations');
    integrations.append(el('p', `Telegram: ${data.integration.telegramConfigured ? 'configured' : 'not configured'} · AI: ${data.integration.provider} · ${data.integration.model}`));
    integrations.append(el('p', `${data.integration.calendar} · Internal Telegram alerts: ${data.integration.staffTelegramConfigured ? 'configured' : 'not configured (events are available below)'}`, 'muted'));
    const funnel = card(`Observed conversion cohort · ${metrics.cohort.count} leads`); funnel.append(el('p', metrics.cohort.definition, 'muted'));
    funnel.append(el('p', `Booked consultation → application: ${rate(metrics.cohort.transitions.consultationToApplication)} (${fraction(metrics.cohort.transitions.consultationToApplication)}). Completed consultation → application: ${rate(metrics.cohort.transitions.completedConsultationToApplication)}. Application → enrollment: ${rate(metrics.cohort.transitions.applicationToEnrollment)} (${fraction(metrics.cohort.transitions.applicationToEnrollment)}).`));
    const table = el('table'); const heading = el('tr'); ['Recorded milestone', 'Reached', 'Share of cohort', 'From previous recorded stage'].forEach(text => heading.append(el('th', text))); table.append(heading);
    for (const stage of metrics.cohort.stages) { const row = el('tr'); append(row, el('td', stage.stage.replace(/_/g, ' ')), el('td', String(stage.observed)), el('td', rate(stage.shareOfCohort)), el('td', stage.fromPrevious ? `${rate(stage.fromPrevious)} (${fraction(stage.fromPrevious)})` : '—')); table.append(row); }
    const scroll = el('div', null, 'scroll'); scroll.append(table); funnel.append(scroll);
    const snapshot = card('Current status snapshot — separate from conversion history'); snapshot.append(el('p', 'Current statuses of leads first seen in the selected period. A status alone does not prove that earlier stages occurred.', 'muted')); for (const status of metrics.currentStatusSnapshot) snapshot.append(el('p', `${status._id.replace(/_/g, ' ')}: ${status.count}`));
    const delivery = card('Delivery & observation details');
    append(delivery, el('p', metrics.reminders.definition, 'muted'), el('pre', JSON.stringify(metrics.reminders.counts, null, 2)), el('p', metrics.followups.definition, 'muted'), el('p', `${metrics.followups.respondedSoFar} responses observed so far / ${metrics.followups.delivered} delivered follow-ups, including windows still open.`), el('p', metrics.attendance.definition, 'muted'), el('p', `Attendance recording coverage: ${rate(metrics.attendance.recordingCoverage)} (${fraction(metrics.attendance.recordingCoverage)}).`), el('p', metrics.latency.replies ? `First reply latency: min ${(metrics.latency.minMs / 1000).toFixed(2)}s, max ${(metrics.latency.maxMs / 1000).toFixed(2)}s. Measured from server receipt to first successful Telegram delivery, including retries.` : 'First reply latency: n/a until a linked reply is successfully delivered.', 'muted'));
    const frequent = card('Frequently asked questions'); frequent.append(el('p', 'Exact question text grouped case-insensitively; commands and booking-form answers excluded.', 'muted')); for (const q of metrics.frequentlyAsked) frequent.append(el('p', `${q.count} × ${q._id}`)); if (!metrics.frequentlyAsked.length) frequent.append(el('p', 'No tracked inquiries in this period.'));
    const unresolved = card('Unanswered inquiries requiring staff'); for (const q of metrics.unanswered) unresolved.append(el('p', `${q.count} × ${q._id}`)); if (!metrics.unanswered.length) unresolved.append(el('p', 'No tracked unanswered inquiries in this period.'));
    view.replaceChildren(filters, grid, funnel, snapshot, frequent, unresolved, delivery, integrations);
  }
  const statuses = ['new', 'qualified', 'consultation_booked', 'consultation_completed', 'considering', 'application', 'offer', 'enrolled', 'not_interested', 'on_hold', 'closed'];
  async function conversations(view) {
    const layout = el('div', null, 'split'); const left = card('Student conversations'); const right = card('Select a student');
    const search = el('input'); search.placeholder = 'Search name, username or phone'; left.append(search);
    const list = el('div'); left.append(list);
    async function updateList() { const result = await api('/leads?q=' + encodeURIComponent(search.value)); list.replaceChildren(); for (const lead of result.items) { list.append(button(`${lead.name || lead.username || 'Student'} · ${lead.status.replace(/_/g, ' ')}`, async () => { selectedLead = lead._id; await leadDetails(right); }, 'listitem')); } if (!result.items.length) list.append(el('p', 'No students found.')); }
    search.onchange = () => updateList().catch(showError); await updateList();
    append(layout, left, right); view.replaceChildren(layout); if (selectedLead) await leadDetails(right);
  }
  async function leadDetails(panel) {
    leadData = await api('/leads/' + selectedLead); const lead = leadData.lead;
    panel.replaceChildren(el('h2', lead.name || lead.username || 'Student'));
    panel.append(el('p', `${lead.language.toUpperCase()} · Priority ${lead.score}/100 · ${lead.intent || 'New inquiry'}`, 'muted'));
    if (lead.summary) panel.append(el('p', lead.summary));
    panel.append(el('p', lead.nextAction || '', 'muted'));
    const controls = el('div', null, 'controls');
    append(controls, button('Edit profile & notes', () => editLead(lead, panel), 'secondary'), button('Schedule follow-up', () => followup(lead, panel), 'secondary'), button('Delete data', async () => { if (confirm('Permanently delete this student conversation and personal data?')) { await api('/leads/' + selectedLead, { method: 'DELETE' }); selectedLead = ''; await load(); } }, 'danger'));
    panel.append(controls); const profile = el('details'); append(profile, el('summary', 'Profile, interests & booking history'), el('pre', JSON.stringify({ phone: lead.phone, interests: lead.profile, notes: lead.notes, assignedTo: lead.assignedTo, objections: lead.objections, followupConsent: lead.followupConsent }, null, 2)));
    for (const booking of leadData.bookings) profile.append(el('p', `${date(booking.start)} · ${booking.consultantName} · ${booking.mode} · ${booking.location}`)); panel.append(profile);
    const messages = el('div'); messages.style.maxHeight = '520px'; messages.style.overflowY = 'auto';
    for (const item of leadData.messages) { const node = el('div', null, 'message ' + item.direction); append(node, el('small', `${item.direction === 'in' ? 'Student' : item.direction === 'staff' ? 'Consultant' : 'AI assistant'} · ${date(item.createdAt)}${item.delivered === false ? ' · DELIVERY FAILED' : ''}`), el('div', item.text)); messages.append(node); } panel.append(messages);
    panel.append(el('p', 'Student chat uses AI only. Human takeover and manual chat replies are disabled.', 'muted'));
  }
  function editLead(lead, panel) {
    const form = el('form'); field(form, 'Full name', 'name', lead.name); field(form, 'Phone', 'phone', lead.phone); select(form, 'Status', 'status', statuses, lead.status); field(form, 'Assigned consultant (staff ID)', 'assignedTo', lead.assignedTo); field(form, 'Staff notes', 'notes', lead.notes, 'textarea');
    for (const key of ['destination', 'degree', 'program', 'intake', 'budget', 'english', 'education', 'scholarship', 'readiness']) field(form, key, key, lead.profile?.[key]);
    form.append(button('Save profile', async () => { const data = new FormData(form); const profile = { ...lead.profile }; for (const key of ['destination', 'degree', 'program', 'intake', 'budget', 'english', 'education', 'scholarship', 'readiness']) profile[key] = data.get(key); await post('/leads/' + lead._id, { name: data.get('name'), phone: data.get('phone'), assignedTo: data.get('assignedTo'), status: data.get('status'), notes: data.get('notes'), profile }, 'PATCH'); $('#dialog').close(); await leadDetails(panel); })); modal('Student profile', form);
  }
  function followup(lead, panel) {
    const form = el('form'); form.append(el('p', lead.followupConsent ? 'This student opted in. Any new message automatically cancels pending follow-ups.' : 'This student has not opted in. Ask them to send /followups first.', 'muted'));
    field(form, 'Send at (your local time)', 'due', '', 'datetime-local'); field(form, 'Personalized message', 'text', '', 'textarea');
    const submit = button('Schedule', async () => { const data = new FormData(form); await post('/leads/' + lead._id + '/followup', { due: new Date(data.get('due')).toISOString(), text: data.get('text') }); $('#dialog').close(); message('Follow-up scheduled'); await leadDetails(panel); }); submit.disabled = !lead.followupConsent; form.append(submit); modal('Schedule a follow-up', form);
  }
  async function knowledge(view) {
    const data = await api('/knowledge'); const c = card('Approved knowledge'); c.append(el('p', 'Only approved, unexpired information is used in answers. Documents start as drafts for review. Versions are kept when editing.', 'muted'));
    const controls = el('div', null, 'controls'); controls.append(button('Add FAQ / University / Service', () => knowledgeEditor()));
    controls.append(button('Import public university drafts', async () => { const result = await post('/knowledge-import-public', {}); message(`${result.created} new drafts · ${result.updated} updated · ${result.unchanged} unchanged. Staff approval required.${result.truncated ? ' Import limited to first 500 public records.' : ''}`); await load(); }, 'secondary'));
    const upload = el('input'); upload.type = 'file'; upload.accept = '.pdf,.docx,.txt,.md,.csv'; upload.style.maxWidth = '310px'; controls.append(upload);
    controls.append(button('Upload draft document', async () => { if (!upload.files[0]) return; const form = new FormData(); form.append('file', upload.files[0]); form.append('language', 'en'); const result = await api('/knowledge-upload', { method: 'POST', body: form }); message(result.truncated ? 'Draft uploaded. Only first 60,000 characters imported; split large documents.' : 'Draft uploaded. Review and approve before use.'); await load(); }, 'secondary')); c.append(controls);
    const table = el('table'); const head = el('tr'); ['Title', 'Category', 'Language', 'Status', 'Version', 'Actions'].forEach(t => head.append(el('th', t))); table.append(head);
    for (const item of data) { const row = el('tr'); append(row, el('td', item.title), el('td', item.category), el('td', item.language.toUpperCase()), el('td', item.validUntil && new Date(item.validUntil) < new Date() ? 'Expired' : item.approved ? 'Approved' : 'Draft'), el('td', String(item.version))); const actions = el('td'); append(actions, button('Edit', () => knowledgeEditor(item), 'secondary'), button('History', () => { const body = el('div'); for (const entry of item.history || []) append(body, el('h3', `Version ${entry.version} · ${date(entry.at)}`), el('pre', entry.content)); modal('Version history', body); }, 'secondary')); row.append(actions); table.append(row); }
    const scroll = el('div', null, 'scroll'); scroll.append(table); c.append(scroll); view.replaceChildren(c);
  }
  function knowledgeEditor(item) {
    const form = el('form'); field(form, 'Title', 'title', item?.title); field(form, 'Category (FAQ, University, Programs, Fees, Office…)', 'category', item?.category || 'FAQ'); select(form, 'Language', 'language', ['en', 'ru', 'uz'], item?.language || 'en'); field(form, 'Approved factual content', 'content', item?.content, 'textarea'); field(form, 'Valid until (optional)', 'validUntil', item?.validUntil ? item.validUntil.slice(0, 10) : '', 'date'); field(form, 'Approved for student answers (administrators only)', 'approved', item?.approved || false, 'checkbox');
    if (item?.sourceUrl) { const link = el('a', 'View public catalog source'); link.href = item.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; form.append(link, el('p', `Imported ${date(item.importedAt)}. Review source details before approving.`, 'muted')); }
    form.append(button('Save', async () => { const data = new FormData(form); await post('/knowledge' + (item ? '/' + item._id : ''), { title: data.get('title'), category: data.get('category'), language: data.get('language'), content: data.get('content'), approved: form.approved.checked, validUntil: data.get('validUntil') ? new Date(data.get('validUntil')).toISOString() : null }, item ? 'PUT' : 'POST'); $('#dialog').close(); await load(); }));
    if (item) form.append(button('Delete', async () => { if (!confirm('Remove this knowledge entry from the approved knowledge base?')) return; await api('/knowledge/' + item._id, { method: 'DELETE' }); $('#dialog').close(); await load(); }, 'danger')); modal(item ? 'Edit knowledge' : 'New knowledge entry', form);
  }
  async function calendar(view) {
    const slots = await api('/slots'); const c = card('Consultation calendar'); c.append(el('p', 'Built-in live availability. Times below use your browser timezone. Students see Tashkent time. Overlapping consultant slots and double bookings are blocked.', 'muted')); c.append(button('Add available slot', () => {
      const form = el('form'); field(form, 'Consultant ID (consistent per consultant)', 'consultantId'); field(form, 'Consultant name', 'consultantName'); field(form, 'Start (local time)', 'start', '', 'datetime-local'); field(form, 'End (local time)', 'end', '', 'datetime-local'); select(form, 'Mode', 'mode', ['online', 'office'], 'online'); field(form, 'Meeting link or office address', 'location');
      form.append(button('Create slot', async () => { const d = Object.fromEntries(new FormData(form)); d.start = new Date(d.start).toISOString(); d.end = new Date(d.end).toISOString(); await post('/slots', d); $('#dialog').close(); await load(); })); modal('Consultation slot', form);
    }));
    for (const slot of slots) { const row = card(); append(row, el('strong', `${date(slot.start)} — ${date(slot.end)}`), el('p', `${slot.consultantName} · ${slot.mode} · ${slot.location}`), el('p', slot.cancelled ? 'Cancelled' : slot.leadId ? `${slot.leadId.name || 'Student'} · ${slot.leadId.phone || ''}` : 'Available', 'pill'));
      const controls = el('div', null, 'controls'); if (!slot.cancelled) controls.append(button('Cancel slot', async () => { if (!confirm('Cancel this slot and notify the booked student?')) return; await post('/slots/' + slot._id, { cancelled: true }, 'PATCH'); await load(); }, 'secondary'));
      if (slot.leadId && new Date(slot.start) <= new Date()) { for (const status of ['attended', 'missed', 'pending']) controls.append(button(status === 'pending' ? 'Reset attendance' : 'Mark ' + status, async () => { await post('/slots/' + slot._id, { attendance: status }, 'PATCH'); await load(); }, 'secondary')); controls.append(el('span', slot.attendance, 'pill')); } row.append(controls); c.append(row); } view.replaceChildren(c);
  }
  async function automation(view) {
    config = await api('/settings'); const c = card('Automation controls'); const form = el('form');
    for (const [key, label] of [['enabled', 'Assistant enabled'], ['autoReplies', 'Automatic answers'], ['bookings', 'Consultation booking'], ['reminders', 'Booking reminders (24h / 6h / 2h / 1h)'], ['followups', 'Opt-in follow-ups']]) field(form, label, key, config[key], 'checkbox');
    select(form, 'Meta wire API', 'metaWireApi', ['responses','chat/completions'], config.metaWireApi || 'responses'); select(form, 'Meta reasoning effort', 'reasoningEffort', ['low','medium','high'], config.reasoningEffort || 'high');
    select(form, 'Meta API endpoint', 'metaEndpoint', ['https://api.meta.ai/v1', 'https://api.llama.com/v1'], config.metaEndpoint || 'https://api.meta.ai/v1');
    field(form, 'Calendar schedule (JSON: Asia/Tashkent; lastStartHour=17 means final appointment at 17:00)', 'availabilityJson', JSON.stringify(config.availability, null, 2), 'textarea');
    select(form, 'AI provider', 'provider', ['meta', 'ollama'], config.provider); field(form, 'Meta model (contributor models are disabled)', 'model', config.model); field(form, 'Internal staff Telegram group/chat ID (optional)', 'staffChatId', config.staffChatId); field(form, 'Retention period in days (closed leads)', 'retentionDays', config.retentionDays, 'number'); field(form, 'Assistant style instructions', 'instructions', config.instructions, 'textarea');
    const schedules = el('fieldset'); schedules.append(el('legend', 'Follow-up timing and approved templates'));
    for (const trigger of ['considering', 'parents', 'documents', 'consultation_completed']) field(schedules, `${trigger.replace(/_/g, ' ')} — days`, 'days_' + trigger, config.followupDays?.[trigger] || 3, 'number');
    for (const lang of ['en', 'ru', 'uz']) field(schedules, `${lang.toUpperCase()} template ({name}, {program})`, 'template_' + lang, config.followupTemplates?.[lang]?.replace(/\/(?:book|reschedule)\b/g, 'Book consultation').replace(/\/stop\b/g, 'Disable follow-ups') || '', 'textarea');
    form.append(schedules);
    form.append(button('Save configuration', async () => { const entries = new FormData(form); const data = Object.fromEntries(entries); for (const key of ['enabled', 'autoReplies', 'bookings', 'reminders', 'followups']) data[key] = form.elements[key].checked; data.availability = JSON.parse(data.availabilityJson); delete data.availabilityJson; data.retentionDays = Number(data.retentionDays); data.followupDays = {}; for (const trigger of ['considering', 'parents', 'documents', 'consultation_completed']) { data.followupDays[trigger] = Number(entries.get('days_' + trigger)); delete data['days_' + trigger]; } data.followupTemplates = {}; for (const lang of ['en', 'ru', 'uz']) { data.followupTemplates[lang] = entries.get('template_' + lang); delete data['template_' + lang]; } await post('/settings', data, 'PUT'); message('Configuration saved'); }));
    const test = card('Test before publishing'); const question = field(test, 'Synthetic question (do not paste private student documents)', 'question'); const lang = select(test, 'Language', 'language', ['en', 'ru', 'uz'], 'en'); const result = el('pre'); test.append(button('Test response', async () => { result.textContent = 'Generating…'; const answer = await post('/test', { text: question.value, language: lang.value, instructions: form.instructions.value }); result.textContent = `${answer.reply}\n\nProvider: ${answer.provider}\nSources: ${answer.sourceIds.length}\nNeeds staff review: ${answer.needsHuman}`; })); test.append(result);
    const cleanup = card('Data retention'); cleanup.append(el('p', 'Cleanup permanently deletes closed or not-interested student profiles older than the retention period. Active applications are preserved.', 'muted')); cleanup.append(button('Run retention cleanup', async () => { if (!confirm('Delete expired closed student data?')) return; const result = await post('/retention-cleanup', {}); message(`${result.deleted} expired profiles removed`); }, 'danger')); c.append(form); view.replaceChildren(c, test, cleanup);
  }
  async function events(view) {
    const [events, jobs] = await Promise.all([api('/events'), api('/jobs')]); const c = card('Staff events & integration issues');
    for (const event of events) { const row = card(); append(row, el('strong', event.kind.replace(/_/g, ' ')), el('small', ' · ' + date(event.createdAt)), el('pre', JSON.stringify(event.detail, null, 2))); if (event.leadId) row.append(button('Open student', async () => { selectedLead = event.leadId; tab = 'Conversations'; await load(); }, 'secondary')); if (!event.resolvedAt) row.append(button('Resolve', async () => { await post('/events/' + event._id, {}, 'PATCH'); await load(); }, 'secondary')); c.append(row); }
    const j = card('Delivery & follow-up queue'); for (const job of jobs) { const row = el('div', null, 'card'); append(row, el('strong', `${job.kind} · ${job.status}`), el('p', `${date(job.due)} · attempts ${job.attempts}${job.errorCode ? ' · ' + job.errorCode : ''}`, 'muted'), el('p', job.text || 'Consultation reminder')); if (['pending', 'failed'].includes(job.status)) row.append(button('Cancel', async () => { await post('/jobs/' + job._id, { status: 'cancelled' }, 'PATCH'); await load(); }, 'secondary')); j.append(row); } view.replaceChildren(c, j);
  }
  load().catch(showError);
})();
