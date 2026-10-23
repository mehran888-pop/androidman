'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BaleClient, BaleError, isValidToken } = require('../src/bale/client');
const { splitMessage } = require('../src/bale/text');
const { formatPayslipMessage, formatPeriodSummary } = require('../src/payroll/payslip-text');

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const originalFetch = global.fetch;

function stubFetch(handler) {
  global.fetch = async (url, options) => handler(url, options);
}

test.afterEach(() => {
  global.fetch = originalFetch;
});

test('توکن معتبر تشخیص داده می‌شود', () => {
  assert.equal(isValidToken(TOKEN), true);
  assert.equal(isValidToken('abc'), false);
  assert.equal(isValidToken(''), false);
});

test('آدرس درخواست با توکن ساخته می‌شود', () => {
  const client = new BaleClient({ token: TOKEN });
  assert.equal(client.url('sendMessage'), `https://tapi.bale.ai/bot${TOKEN}/sendMessage`);
});

test('sendMessage بدنه‌ی درست و parse_mode را می‌فرستد', async () => {
  let captured;
  stubFetch(async (url, options) => {
    captured = { url, body: JSON.parse(options.body), method: options.method };
    return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
  });

  const client = new BaleClient({ token: TOKEN });
  const result = await client.sendMessage(12345, 'سلام <b>دنیا</b>');
  assert.equal(result.message_id, 7);
  assert.equal(captured.method, 'POST');
  assert.match(captured.url, /\/sendMessage$/);
  assert.equal(captured.body.chat_id, 12345);
  assert.equal(captured.body.text, 'سلام <b>دنیا</b>');
  assert.equal(captured.body.parse_mode, 'HTML');
});

test('خطای API بله به BaleError تبدیل می‌شود', async () => {
  stubFetch(async () =>
    new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 }),
  );
  const client = new BaleClient({ token: TOKEN });
  await assert.rejects(() => client.getMe(), (err) => {
    assert.equal(err instanceof BaleError, true);
    assert.match(err.message, /chat not found/);
    assert.equal(err.status, 400);
    return true;
  });
});

test('خطای شبکه به پیام فارسی تبدیل می‌شود', async () => {
  stubFetch(async () => {
    throw new Error('ECONNREFUSED');
  });
  const client = new BaleClient({ token: TOKEN });
  await assert.rejects(() => client.getMe(), /ارتباط با بله برقرار نشد/);
});

test('بدون توکن خطای روشن می‌دهد', () => {
  assert.throws(() => new BaleClient({}), /توکن/);
});

test('getUpdates پارامترها را درست می‌فرستد', async () => {
  let body;
  stubFetch(async (url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
  });
  const client = new BaleClient({ token: TOKEN });
  const result = await client.getUpdates({ offset: 42, timeout: 30 });
  assert.deepEqual(result, []);
  assert.equal(body.offset, 42);
  assert.equal(body.timeout, 30);
});

test('پیام‌های بلند به چند تکه شکسته می‌شوند', () => {
  const text = Array.from({ length: 200 }, (_, i) => `خط شماره ${i} با متن آزمایشی`).join('\n');
  const chunks = splitMessage(text, 500);
  assert.ok(chunks.length > 1);
  chunks.forEach((c) => assert.ok(c.length <= 500));
  assert.equal(chunks.join('\n').replace(/\s+/g, ' ').trim().length > 0, true);
});

test('پیام کوتاه تکه نمی‌شود', () => {
  assert.deepEqual(splitMessage('سلام'), ['سلام']);
});

test('فیش حقوقی شامل خالص پرداختی و نام است', () => {
  const payslip = {
    employee: { fullName: 'علی رضایی', personnelCode: '1002', position: 'کارشناس' },
    input: { daysWorked: 30, effectiveDays: 30, overtimeHours: 5, nightHours: 0 },
    earnings: [
      { key: 'baseSalary', label: 'حقوق پایه', amount: 20000000 },
      { key: 'foodAllowance', label: 'بن خواربار', amount: 2200000 },
    ],
    deductions: [{ key: 'insurance', label: 'بیمه تأمین اجتماعی (سهم کارگر)', amount: 1554000 }],
    gross: 22200000,
    net: 20646000,
    employer: { totalCost: 25000000 },
  };
  const text = formatPayslipMessage(payslip, { period: '1404-07', orgName: 'شرکت تست' });
  assert.match(text, /علی رضایی/);
  assert.match(text, /20,646,000/);
  assert.match(text, /مهر 1404/);
  assert.match(text, /شرکت تست/);
});

test('اطلاعات کاربر در پیام HTML امن می‌شود', () => {
  const text = formatPayslipMessage(
    {
      employee: { fullName: '<script>alert(1)</script>', personnelCode: '1' },
      input: { effectiveDays: 30 },
      earnings: [],
      deductions: [],
      gross: 0,
      net: 0,
      employer: {},
    },
    { period: '1404-07' },
  );
  assert.equal(text.includes('<script>'), false);
  assert.match(text, /&lt;script&gt;/);
});

test('خلاصه‌ی دوره جمع‌ها را نشان می‌دهد', () => {
  const text = formatPeriodSummary(
    { headcount: 12, gross: 100000000, insurance: 6000000, tax: 3000000, deductions: 9000000, net: 91000000, employerCost: 120000000 },
    { period: '1404-08', orgName: 'پارس' },
  );
  assert.match(text, /12/);
  assert.match(text, /91,000,000/);
  assert.match(text, /آبان 1404/);
});
