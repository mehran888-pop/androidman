'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hoghooghyar-test-'));
process.env.PAYROLL_DATA_DIR = tmpDir;

const { createApp } = require('../src/app');
const store = require('../src/store');
const { webhookSecret } = require('../src/routes/api');

let server;
let base;

test.before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const call = async (path, options = {}) => {
  const res = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
};

let employeeId;
let periodKey;

test('سلامت سرویس', async () => {
  const res = await call('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
  assert.ok(res.data.today.key);
});

test('وضعیت اولیه خالی است', async () => {
  const res = await call('/api/state');
  assert.equal(res.status, 200);
  assert.equal(res.data.employeesCount, 0);
  assert.equal(res.data.settings.baleToken, '');
  assert.ok(Array.isArray(res.data.periods));
  assert.ok(res.data.rules.taxBrackets.length > 0);
});

test('افزودن پرسنل بدون نام خطا می‌دهد', async () => {
  const res = await call('/api/employees', { method: 'POST', body: {} });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /نام/);
});

test('افزودن پرسنل و دریافت آن', async () => {
  const res = await call('/api/employees', {
    method: 'POST',
    body: { fullName: 'علی رضایی', personnelCode: '1001', baseSalary: 30000000, children: 1 },
  });
  assert.equal(res.status, 201);
  employeeId = res.data.employee.id;
  assert.ok(employeeId);
  assert.equal(res.data.employee.baseSalary, 30000000);

  const list = await call('/api/employees');
  assert.equal(list.data.employees.length, 1);
});

test('ویرایش پرسنل', async () => {
  const res = await call(`/api/employees/${employeeId}`, {
    method: 'PUT',
    body: { position: 'کارشناس مالی', baseSalary: '۳۲,۰۰۰,۰۰۰' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.employee.position, 'کارشناس مالی');
  assert.equal(res.data.employee.baseSalary, 32000000);
});

test('محاسبه‌ی دوره', async () => {
  const meta = await call('/api/state');
  periodKey = meta.data.today.key;
  const res = await call(`/api/period/${periodKey}`);
  assert.equal(res.status, 200);
  assert.equal(res.data.items.length, 1);
  assert.equal(res.data.key, periodKey);
  assert.ok(res.data.totals.net > 0);
  assert.ok(res.data.items[0].payslip.net > 0);
});

test('ذخیره‌ی اقلام متغیر دوره و بازگشت محاسبه‌ی جدید', async () => {
  const res = await call(`/api/period/${periodKey}/input/${employeeId}`, {
    method: 'PUT',
    body: { overtimeHours: 12, daysWorked: 30, loanInstallment: 1000000 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.payslip.input.overtimeHours, 12);
  assert.ok(res.data.payslip.deductions.some((d) => d.key === 'loanInstallment'));

  const again = await call(`/api/period/${periodKey}`);
  assert.equal(again.data.items[0].inputs.overtimeHours, 12);
});

test('پیش‌نمایش بدون ذخیره‌سازی', async () => {
  const res = await call('/api/preview', {
    method: 'POST',
    body: { employeeId, inputs: { overtimeHours: 40 } },
  });
  assert.equal(res.status, 200);
  const ot = res.data.payslip.earnings.find((e) => e.key === 'overtime');
  assert.ok(ot.amount > 0);

  const stored = await call(`/api/period/${periodKey}`);
  assert.equal(stored.data.items[0].inputs.overtimeHours, 12);
});

test('دوره‌ی نامعتبر رد می‌شود', async () => {
  const res = await call('/api/period/1404-13');
  assert.equal(res.status, 400);
});

test('ذخیره‌ی نرخ‌ها', async () => {
  const res = await call('/api/rules', {
    method: 'PUT',
    body: { housingAllowance: 1200000, employeeInsuranceRate: 0.07 },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.rules.housingAllowance, 1200000);
});

test('اعمال نرخ‌های سال از پیش‌تنظیم‌ها', async () => {
  const res = await call('/api/rules/preset/1404', { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(res.data.rules.year, 1404);
  assert.equal(res.data.rules.minimumMonthlyWage, 10492800);

  const back = await call('/api/rules/preset/1405', { method: 'POST' });
  assert.equal(back.data.rules.year, 1405);
  assert.equal(back.data.rules.taxBrackets[0].upTo, 40000000);

  const missing = await call('/api/rules/preset/1300', { method: 'POST' });
  assert.equal(missing.status, 404);
});

test('پله‌های مالیات نامعتبر نادیده گرفته می‌شوند', async () => {
  const before = await call('/api/rules');
  const res = await call('/api/rules', { method: 'PUT', body: { taxBrackets: [] } });
  assert.equal(res.status, 200);
  assert.equal(res.data.rules.taxBrackets.length, before.data.rules.taxBrackets.length);
});

test('توکن بله ماسک می‌شود ولی ذخیره می‌گردد', async () => {
  await call('/api/settings', { method: 'PUT', body: { baleToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw' } });
  const state = await call('/api/state');
  assert.equal(state.data.settings.hasBaleToken, true);
  assert.ok(state.data.settings.baleToken.includes('••••'));
  assert.equal(store.getSettings({ mask: false }).baleToken.length > 20, true);
});

test('پاک‌کردن توکن', async () => {
  const res = await call('/api/settings', { method: 'PUT', body: { clearBaleToken: true } });
  assert.equal(res.data.settings.hasBaleToken, false);
});

test('ارسال خشک بدون توکن؟ باید خطای روشن بدهد', async () => {
  const res = await call('/api/bale/send', { method: 'POST', body: { period: periodKey, dryRun: false } });
  assert.equal(res.status, 400);
  assert.match(res.data.error, /توکن/);
});

test('پیش‌نمایش ارسال (dry-run) بدون شبکه', async () => {
  store.setEmployeeChatId(employeeId, '555666777');
  const res = await call('/api/bale/send', {
    method: 'POST',
    body: { period: periodKey, dryRun: true, force: true },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.dryRun, true);
  const item = res.data.results.find((r) => r.employeeId === employeeId);
  assert.equal(item.status, 'dry-run');
  assert.match(item.preview, /فیش حقوقی/);
});

test('پرسنل بدون شناسه چت در dry-run نادیده گرفته می‌شود', async () => {
  const second = await call('/api/employees', {
    method: 'POST',
    body: { fullName: 'مریم حسینی', personnelCode: '1002', baseSalary: 20000000 },
  });
  const res = await call('/api/bale/send', {
    method: 'POST',
    body: { period: periodKey, dryRun: true, employeeIds: [second.data.employee.id] },
  });
  assert.equal(res.data.results[0].status, 'skipped');
  await call(`/api/employees/${second.data.employee.id}`, { method: 'DELETE' });
});

test('ارسال واقعی به بله (با شبیه‌سازی API) و جلوگیری از تکرار', async () => {
  const originalFetch = global.fetch;
  const sent = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('tapi.bale.ai')) {
      const body = JSON.parse(options.body || '{}');
      sent.push(body);
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 });
    }
    return originalFetch(url, options);
  };

  try {
    await call('/api/settings', {
      method: 'PUT',
      body: { baleToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', sendDelayMs: 0 },
    });
    await call(`/api/employees/${employeeId}`, { method: 'PUT', body: { baleChatId: '987654321' } });

    const first = await call('/api/bale/send', { method: 'POST', body: { period: periodKey } });
    assert.equal(first.status, 200);
    const mine = first.data.results.find((r) => r.employeeId === employeeId);
    assert.equal(mine.status, 'sent');
    const message = sent.find((m) => String(m.chat_id) === '987654321');
    assert.ok(message);
    assert.match(message.text, /فیش حقوقی/);
    assert.equal(message.parse_mode, 'HTML');

    const second = await call('/api/bale/send', { method: 'POST', body: { period: periodKey } });
    const again = second.data.results.find((r) => r.employeeId === employeeId);
    assert.equal(again.status, 'already-sent');

    const forced = await call('/api/bale/send', { method: 'POST', body: { period: periodKey, force: true } });
    assert.equal(forced.data.results.find((r) => r.employeeId === employeeId).status, 'sent');

    const deliveries = await call(`/api/bale/deliveries?period=${periodKey}`);
    assert.ok(deliveries.data.deliveries.some((d) => d.status === 'sent'));
    const state = await call(`/api/period/${periodKey}`);
    assert.equal(state.data.items[0].sent, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('خطای بله در ارسال، در گزارش ثبت می‌شود', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('tapi.bale.ai')) {
      return new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 });
    }
    return originalFetch(url, options);
  };
  try {
    const res = await call('/api/bale/send', { method: 'POST', body: { period: periodKey, force: true } });
    const mine = res.data.results.find((r) => r.employeeId === employeeId);
    assert.equal(mine.status, 'failed');
    assert.match(mine.error, /chat not found/);
    assert.equal(res.data.summary.failed >= 1, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('خروجی CSV شامل سرستون‌ها و BOM است', async () => {
  const res = await fetch(`${base}/api/export/${periodKey}.csv`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const text = buffer.toString('utf8');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  // BOM برای نمایش صحیح فارسی در Excel
  assert.deepEqual([...buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(text, /کد پرسنلی/);
  assert.match(text, /علی رضایی/);
});

test('خروجی متنی فیش‌ها', async () => {
  const res = await fetch(`${base}/api/export/${periodKey}.txt`);
  const text = await res.text();
  assert.match(text, /فیش حقوقی/);
});

test('وب‌هوک با secret نادرست ۴۰۴ می‌دهد', async () => {
  const res = await call('/api/bale/hook/wrong-secret', { method: 'POST', body: {} });
  assert.equal(res.status, 404);
});

test('وب‌هوک با secret درست پاسخ ok می‌دهد', async () => {
  const res = await call(`/api/bale/hook/${webhookSecret()}`, {
    method: 'POST',
    body: { update_id: 1, message: { chat: { id: 123 }, text: '/help' } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.ok, true);
});

test('رمز پنل، دسترسی بدون رمز را می‌بندد', async () => {
  await call('/api/settings', { method: 'PUT', body: { panelPassword: 'secret123' } });

  const denied = await call('/api/state');
  assert.equal(denied.status, 401);

  const allowed = await call('/api/state', { headers: { 'x-panel-password': 'secret123' } });
  assert.equal(allowed.status, 200);

  const wrong = await call('/api/state', { headers: { 'x-panel-password': 'nope' } });
  assert.equal(wrong.status, 401);

  await call('/api/settings', { method: 'PUT', body: { panelPassword: '' }, headers: { 'x-panel-password': 'secret123' } });
});

test('مسیر ناشناخته ۴۰۴ JSON می‌دهد', async () => {
  const res = await call('/api/unknown-route');
  assert.equal(res.status, 404);
  assert.ok(res.data.error);
});

test('صفحه‌ی اصلی سرو می‌شود', async () => {
  const res = await fetch(base);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /حقوق‌یار/);
});
