/* No student data or AI output is inserted as HTML. All dynamic text uses textContent. */
(() => {
  'use strict';
  let token = sessionStorage.getItem('admissions_staff_token') || localStorage.getItem('auth_accessToken') || '';
  let tab = 'Overview'; let selectedLead = ''; let leadData; let config;
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
    const data = await api('/overview'); const grid = el('div', null, 'grid');
    for (const [label, value] of [['Student leads', data.leads], ['Incoming messages', data.incoming], ['Verified AI replies', data.aiResolvedMessages], ['Active bookings', data.bookings], ['Human handovers', data.handovers], ['Average response (s)', Math.round(data.averageResponseMs / 1000)]]) { const c = card(); append(c, el('div', String(value), 'stat'), el('p', label, 'muted')); grid.append(c); }
    const integrations = card('Integrations');
    integrations.append(el('p', `Telegram: ${data.integration.telegramConfigured ? 'configured' : 'not configured'} · AI: ${data.integration.provider} · ${data.integration.model}`));
    integrations.append(el('p', `${data.integration.calendar} · Internal Telegram alerts: ${data.integration.staffTelegramConfigured ? 'configured' : 'not configured (events are available below)'}`, 'muted'));
    const funnel = card('Lead pipeline'); const rows = data.statuses.map(item => `${item._id.replace(/_/g, ' ')}: ${item.count}`); funnel.append(el('pre', rows.join('\n') || 'No leads yet.'));
    const unresolved = card('Questions awaiting an approved answer'); for (const q of data.unanswered) unresolved.append(el('p', `${q.count} × ${q._id}`)); if (!data.unanswered.length) unresolved.append(el('p', 'No unanswered questions.'));
    view.replaceChildren(grid, integrations, funnel, unresolved);
  }
  const statuses = ['new', 'qualified', 'consultation_booked', 'consultation_completed', 'considering', 'application', 'offer', 'enrolled', 'not_interested', 'on_hold', 'closed'];
  async function conversations(view) {
    const layout = el('div', null, 'split'); const left = card('Student conversations'); const right = card('Select a student');
    const search = el('input'); search.placeholder = 'Search name, username or phone'; left.append(search);
    const list = el('div'); left.append(list);
    async function updateList() { const result = await api('/leads?q=' + encodeURIComponent(search.value)); list.replaceChildren(); for (const lead of result.items) { list.append(button(`${lead.name || lead.username || 'Student'} · ${lead.status.replace(/_/g, ' ')}${lead.aiPaused ? ' · HUMAN' : ''}`, async () => { selectedLead = lead._id; await leadDetails(right); }, 'listitem')); } if (!result.items.length) list.append(el('p', 'No students found.')); }
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
    append(controls, button(lead.aiPaused ? 'Resume AI' : 'Take over / Pause AI', async () => { await post('/leads/' + selectedLead, { aiPaused: !lead.aiPaused }, 'PATCH'); await leadDetails(panel); }), button('Edit profile & notes', () => editLead(lead, panel), 'secondary'), button('Schedule follow-up', () => followup(lead, panel), 'secondary'), button('Delete data', async () => { if (confirm('Permanently delete this student conversation and personal data?')) { await api('/leads/' + selectedLead, { method: 'DELETE' }); selectedLead = ''; await load(); } }, 'danger'));
    panel.append(controls); const profile = el('details'); append(profile, el('summary', 'Profile, interests & booking history'), el('pre', JSON.stringify({ phone: lead.phone, interests: lead.profile, notes: lead.notes, assignedTo: lead.assignedTo, objections: lead.objections, followupConsent: lead.followupConsent }, null, 2)));
    for (const booking of leadData.bookings) profile.append(el('p', `${date(booking.start)} · ${booking.consultantName} · ${booking.mode} · ${booking.location}`)); panel.append(profile);
    const messages = el('div'); messages.style.maxHeight = '520px'; messages.style.overflowY = 'auto';
    for (const item of leadData.messages) { const node = el('div', null, 'message ' + item.direction); append(node, el('small', `${item.direction === 'in' ? 'Student' : item.direction === 'staff' ? 'Consultant' : 'AI assistant'} · ${date(item.createdAt)}${item.delivered === false ? ' · DELIVERY FAILED' : ''}`), el('div', item.text)); messages.append(node); } panel.append(messages);
    const reply = el('textarea'); reply.placeholder = 'Reply as a consultant. Sending pauses AI for this student.'; panel.append(reply);
    panel.append(button('Send consultant reply', async () => { if (!reply.value.trim()) return; await post('/leads/' + selectedLead + '/reply', { text: reply.value }); await leadDetails(panel); }));
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
    const upload = el('input'); upload.type = 'file'; upload.accept = '.pdf,.docx,.txt,.md,.csv'; upload.style.maxWidth = '310px'; controls.append(upload);
    controls.append(button('Upload draft document', async () => { if (!upload.files[0]) return; const form = new FormData(); form.append('file', upload.files[0]); form.append('language', 'en'); const result = await api('/knowledge-upload', { method: 'POST', body: form }); message(result.truncated ? 'Draft uploaded. Only first 60,000 characters imported; split large documents.' : 'Draft uploaded. Review and approve before use.'); await load(); }, 'secondary')); c.append(controls);
    const table = el('table'); const head = el('tr'); ['Title', 'Category', 'Language', 'Status', 'Version', 'Actions'].forEach(t => head.append(el('th', t))); table.append(head);
    for (const item of data) { const row = el('tr'); append(row, el('td', item.title), el('td', item.category), el('td', item.language.toUpperCase()), el('td', item.validUntil && new Date(item.validUntil) < new Date() ? 'Expired' : item.approved ? 'Approved' : 'Draft'), el('td', String(item.version))); const actions = el('td'); append(actions, button('Edit', () => knowledgeEditor(item), 'secondary'), button('History', () => { const body = el('div'); for (const entry of item.history || []) append(body, el('h3', `Version ${entry.version} · ${date(entry.at)}`), el('pre', entry.content)); modal('Version history', body); }, 'secondary')); row.append(actions); table.append(row); }
    const scroll = el('div', null, 'scroll'); scroll.append(table); c.append(scroll); view.replaceChildren(c);
  }
  function knowledgeEditor(item) {
    const form = el('form'); field(form, 'Title', 'title', item?.title); field(form, 'Category (FAQ, University, Programs, Fees, Office…)', 'category', item?.category || 'FAQ'); select(form, 'Language', 'language', ['en', 'ru', 'uz'], item?.language || 'en'); field(form, 'Approved factual content', 'content', item?.content, 'textarea'); field(form, 'Valid until (optional)', 'validUntil', item?.validUntil ? item.validUntil.slice(0, 10) : '', 'date'); field(form, 'Approved for student answers (administrators only)', 'approved', item?.approved || false, 'checkbox');
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
      if (slot.leadId) { controls.append(button('Mark attended', async () => { await post('/slots/' + slot._id, { attendance: 'attended' }, 'PATCH'); await load(); }, 'secondary')); controls.append(el('span', slot.attendance, 'pill')); } row.append(controls); c.append(row); } view.replaceChildren(c);
  }
  async function automation(view) {
    config = await api('/settings'); const c = card('Automation controls'); const form = el('form');
    for (const [key, label] of [['enabled', 'Assistant enabled'], ['autoReplies', 'Automatic answers'], ['bookings', 'Consultation booking'], ['reminders', 'Booking reminders (24h / 6h / 2h / 1h)'], ['followups', 'Opt-in follow-ups']]) field(form, label, key, config[key], 'checkbox');
    select(form, 'AI provider', 'provider', ['meta', 'ollama'], config.provider); field(form, 'Meta model (contributor models are disabled)', 'model', config.model); field(form, 'Internal staff Telegram group/chat ID (optional)', 'staffChatId', config.staffChatId); field(form, 'Retention period in days (closed leads)', 'retentionDays', config.retentionDays, 'number'); field(form, 'Assistant style instructions', 'instructions', config.instructions, 'textarea');
    const schedules = el('fieldset'); schedules.append(el('legend', 'Follow-up timing and approved templates'));
    for (const trigger of ['considering', 'parents', 'documents', 'consultation_completed']) field(schedules, `${trigger.replace(/_/g, ' ')} — days`, 'days_' + trigger, config.followupDays?.[trigger] || 3, 'number');
    for (const lang of ['en', 'ru', 'uz']) field(schedules, `${lang.toUpperCase()} template ({name}, {program})`, 'template_' + lang, config.followupTemplates?.[lang] || '', 'textarea');
    form.append(schedules);
    form.append(button('Save configuration', async () => { const entries = new FormData(form); const data = Object.fromEntries(entries); for (const key of ['enabled', 'autoReplies', 'bookings', 'reminders', 'followups']) data[key] = form.elements[key].checked; data.retentionDays = Number(data.retentionDays); data.followupDays = {}; for (const trigger of ['considering', 'parents', 'documents', 'consultation_completed']) { data.followupDays[trigger] = Number(entries.get('days_' + trigger)); delete data['days_' + trigger]; } data.followupTemplates = {}; for (const lang of ['en', 'ru', 'uz']) { data.followupTemplates[lang] = entries.get('template_' + lang); delete data['template_' + lang]; } await post('/settings', data, 'PUT'); message('Configuration saved'); }));
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
