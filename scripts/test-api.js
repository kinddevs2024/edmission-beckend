/**
 * Проверка основных эндпоинтов API (backend должен быть запущен на http://localhost:4000).
 * Запуск: node scripts/test-api.js
 */
const BASE = 'http://localhost:4000/api';

async function request(method, path, body = null, token = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {}
  return { ok: res.ok, status: res.status, data, text };
}

async function main() {
  const results = [];
  const check = (name, ok, status, extra = '') => {
    const pass = ok && status >= 200 && status < 400;
    results.push({ name, pass, status, extra });
    console.log(pass ? `  \x1b[32m✓\x1b[0m ${name}` : `  \x1b[31m✗\x1b[0m ${name} (${status}) ${extra}`);
  };

  console.log('Testing API at', BASE, '\n');

  // Public auth
  let r = await request('POST', '/auth/register', { email: 'test-api@example.com', password: 'Test123!', role: 'student' });
  if (r.status === 409) {
    r = await request('POST', '/auth/login', { email: 'test-api@example.com', password: 'Test123!' });
  }
  if (!r.ok && r.status !== 409) {
    r = await request('POST', '/auth/login', { email: 'test-api@example.com', password: 'Test123!' });
  }
  check('POST /auth/register or login', r.ok || r.status === 409, r.status, r.data?.message || '');

  const token = r.data?.accessToken;
  if (!token) {
    console.log('\n  No token — skipping authenticated routes. Register or login manually to get token.');
    console.log('\nSummary:', results.filter((x) => x.pass).length, '/', results.length, 'passed');
    process.exit(results.every((x) => x.pass) ? 0 : 1);
  }

  r = await request('GET', '/auth/me', null, token);
  check('GET /auth/me', r.ok, r.status);

  // Student (with token)
  r = await request('GET', '/student/universities', null, token);
  check('GET /student/universities', r.ok, r.status, r.data?.data?.length != null ? `(${r.data.data.length} items)` : '');

  r = await request('GET', '/student/compare?ids=', null, token);
  check('GET /student/compare', r.ok, r.status);

  r = await request('GET', '/student/applications', null, token);
  check('GET /student/applications', r.ok, r.status);

  r = await request('GET', '/student/offers', null, token);
  check('GET /student/offers', r.ok, r.status);

  r = await request('GET', '/student/recommendations', null, token);
  check('GET /student/recommendations', r.ok, r.status);

  // Chat
  r = await request('GET', '/chat', null, token);
  check('GET /chat', r.ok, r.status);

  // Notifications
  r = await request('GET', '/notifications', null, token);
  check('GET /notifications', r.ok, r.status);

  // Admin health (may 403 if not admin)
  r = await request('GET', '/admin/health', null, token);
  check('GET /admin/health', r.ok || r.status === 403, r.status);

  console.log('\nSummary:', results.filter((x) => x.pass).length, '/', results.length, 'passed');
  process.exit(results.every((x) => x.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
