'use strict';

const express = require('express');
const crypto = require('crypto');

const store = require('../store');
const { calculatePayslip, calculatePeriod } = require('../payroll/calc');
const { recentPeriods, parsePeriod, periodKey, periodLabel, todayJalali, MONTHS } = require('../payroll/jalali');
const { formatPayslipMessage, money } = require('../payroll/payslip-text');
const { BaleClient, BaleError, isValidToken } = require('../bale/client');
const { sendPeriodPayslips, sendTestMessage, buildClient } = require('../bale/notify');
const { handleUpdate } = require('../bale/commands');

const router = express.Router();

/* ---------------------------------- احراز هویت --------------------------------- */

const authState = { failures: 0, blockedUntil: 0 };

function panelPassword() {
  return String(store.load().settings.panelPassword || process.env.PANEL_PASSWORD || '');
}

function requireAuth(req, res, next) {
  const pass = panelPassword();
  if (!pass) return next();
  if (Date.now() < authState.blockedUntil) {
    return res.status(429).json({ error: 'تلاش‌های ناموفق زیاد بود. یک دقیقه بعد دوباره تلاش کنید.' });
  }
  const provided = req.get('x-panel-password') || req.query.password || '';
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(pass).digest();
  if (crypto.timingSafeEqual(a, b)) {
    authState.failures = 0;
    return next();
  }
  authState.failures += 1;
  if (authState.failures >= 6) {
    authState.failures = 0;
    authState.blockedUntil = Date.now() + 60_000;
  }
  return res.status(401).json({ error: 'رمز عبور پنل نادرست است.' });
}

router.use((req, res, next) => {
  if (req.path.startsWith('/health') || req.path.startsWith('/auth')) return next();
  return requireAuth(req, res, next);
});

/* ------------------------------------ عمومی ----------------------------------- */

router.get('/health', (req, res) => {
  const now = todayJalali();
  res.json({
    ok: true,
    app: 'hoghooghyar',
    version: require('../../package.json').version,
    today: { ...now, key: periodKey(now.jy, now.jm), label: periodLabel(now.jy, now.jm) },
    authRequired: Boolean(panelPassword()),
  });
});

router.post('/auth/check', requireAuth, (req, res) => res.json({ ok: true }));

router.get('/state', (req, res) => {
  const now = todayJalali();
  res.json({
    organization: store.getOrganization(),
    settings: store.getSettings(),
    rules: store.getRules(),
    today: { ...now, key: periodKey(now.jy, now.jm), label: periodLabel(now.jy, now.jm) },
    periods: recentPeriods(14),
    months: MONTHS,
    presetYears: store.PRESET_YEARS,
    employeesCount: store.listEmployees({ includeInactive: false }).length,
    appVersion: require('../../package.json').version,
  });
});

/* ----------------------------------- پرسنل ----------------------------------- */

router.get('/employees', (req, res) => {
  res.json({ employees: store.listEmployees({ includeInactive: req.query.all !== 'false' }) });
});

router.post('/employees', (req, res) => {
  const body = req.body || {};
  if (!String(body.fullName || '').trim()) {
    return res.status(400).json({ error: 'نام و نام خانوادگی الزامی است.' });
  }
  const employee = store.createEmployee(body);
  return res.status(201).json({ employee });
});

router.get('/employees/:id', (req, res) => {
  const employee = store.getEmployee(req.params.id);
  if (!employee) return res.status(404).json({ error: 'پرسنل پیدا نشد.' });
  return res.json({ employee });
});

router.put('/employees/:id', (req, res) => {
  const employee = store.updateEmployee(req.params.id, req.body || {});
  if (!employee) return res.status(404).json({ error: 'پرسنل پیدا نشد.' });
  return res.json({ employee });
});

router.delete('/employees/:id', (req, res) => {
  const ok = store.deleteEmployee(req.params.id);
  if (!ok) return res.status(404).json({ error: 'پرسنل پیدا نشد.' });
  return res.json({ ok: true });
});

/* ----------------------------------- دوره‌ها ---------------------------------- */

router.get('/period/suggest', (req, res) => {
  const now = todayJalali();
  res.json({ key: periodKey(now.jy, now.jm) });
});

router.get('/period/:key', (req, res) => {
  const parsed = parsePeriod(req.params.key);
  if (!parsed) return res.status(400).json({ error: 'دوره‌ی نامعتبر است.' });
  const key = periodKey(parsed.jy, parsed.jm);
  const rules = store.getRules();
  const inputs = store.getPeriodInputs(key);
  const employees = store.listEmployees({ includeInactive: false });
  const { items, totals } = calculatePeriod(employees, inputs, rules);
  const deliveries = store.listDeliveries({ period: key, limit: 200 });
  const sentIds = new Set(deliveries.filter((d) => d.status === 'sent').map((d) => d.employeeId));

  return res.json({
    key,
    label: periodLabel(parsed.jy, parsed.jm),
    rules,
    totals,
    employees: employees.map((e) => ({
      id: e.id,
      fullName: e.fullName,
      personnelCode: e.personnelCode,
      position: e.position,
      department: e.department,
      baleChatId: e.baleChatId,
      sent: sentIds.has(e.id),
    })),
    items: items.map((item) => ({
      employeeId: item.employeeId,
      inputs: item.inputs,
      payslip: item,
      sent: sentIds.has(item.employeeId),
    })),
    deliveries,
  });
});

router.put('/period/:key/input/:employeeId', (req, res) => {
  const parsed = parsePeriod(req.params.key);
  if (!parsed) return res.status(400).json({ error: 'دوره‌ی نامعتبر است.' });
  const key = periodKey(parsed.jy, parsed.jm);
  const saved = store.setPeriodInput(key, req.params.employeeId, req.body || {});
  if (!saved) return res.status(404).json({ error: 'دوره یا پرسنل پیدا نشد.' });
  const employee = store.getEmployee(req.params.employeeId);
  const payslip = calculatePayslip(employee, saved, store.getRules());
  return res.json({ inputs: saved, payslip });
});

router.post('/period/:key/copy', (req, res) => {
  const parsed = parsePeriod(req.params.key);
  const from = parsePeriod(req.body?.from);
  if (!parsed || !from) return res.status(400).json({ error: 'دوره‌ی مبدأ یا مقصد نامعتبر است.' });
  const ok = store.copyPeriodInputs(
    periodKey(from.jy, from.jm),
    periodKey(parsed.jy, parsed.jm),
  );
  if (!ok) return res.status(400).json({ error: 'کپی انجام نشد.' });
  return res.json({ ok: true });
});

/** پیش‌نمایش زنده‌ی فیش بدون ذخیره‌سازی (برای فرم ویرایش) */
router.post('/preview', (req, res) => {
  const { employeeId, inputs, rules } = req.body || {};
  const employee = employeeId ? store.getEmployee(employeeId) : (req.body?.employee || {});
  if (!employee) return res.status(404).json({ error: 'پرسنل پیدا نشد.' });
  const payslip = calculatePayslip(
    employee,
    { ...(inputs || {}) },
    rules && typeof rules === 'object' && Object.keys(rules).length ? { ...store.getRules(), ...rules } : store.getRules(),
  );
  return res.json({ payslip });
});

/* ----------------------------------- تنظیمات ---------------------------------- */

router.get('/rules', (req, res) => res.json({ rules: store.getRules(), presetYears: store.PRESET_YEARS }));
router.post('/rules/preset/:year', (req, res) => {
  const rules = store.applyYearPreset(req.params.year);
  if (!rules) return res.status(404).json({ error: 'نرخ‌های این سال موجود نیست.' });
  return res.json({ rules });
});
router.put('/rules', (req, res) => {
  const rules = store.updateRules(req.body || {});
  return res.json({ rules });
});

router.get('/settings', (req, res) => {
  res.json({ settings: store.getSettings(), organization: store.getOrganization() });
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  if (body.organization) store.updateOrganization(body.organization);
  if (body.panelPassword !== undefined) {
    const db = store.load();
    const pass = String(body.panelPassword || '');
    db.settings.panelPassword = pass;
    store.save();
  }
  const settings = store.updateSettings(body);
  return res.json({ settings, organization: store.getOrganization() });
});

/* ------------------------------------ بله ------------------------------------ */

function clientOrThrow() {
  const settings = store.getSettings({ mask: false });
  const token = settings.baleToken || process.env.BALE_BOT_TOKEN || '';
  if (!token) throw new BaleError('ابتدا توکن ربات بله را ذخیره کنید.');
  if (!isValidToken(token)) throw new BaleError('قالب توکن معتبر نیست. نمونه: 123456789:AA...');
  return new BaleClient({ token });
}

router.post('/bale/test', async (req, res) => {
  try {
    const client = clientOrThrow();
    const me = await client.getMe();
    return res.json({
      ok: true,
      bot: me,
      message: `✅ اتصال برقرار است. ربات: @${me.username || me.first_name || '—'}`,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'اتصال به بله ناموفق بود.' });
  }
});

router.post('/bale/test-message', async (req, res) => {
  try {
    const result = await sendTestMessage('✅ پیام آزمایشی حقوق‌یار — اتصال ربات بله سالم است.');
    return res.json({ ok: true, ...result });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'ارسال پیام آزمایشی ناموفق بود.' });
  }
});

router.post('/bale/webhook', async (req, res) => {
  try {
    const client = clientOrThrow();
    if (req.body?.delete) {
      await client.deleteWebhook();
      return res.json({ ok: true, message: 'وب‌هوک حذف شد.' });
    }
    const publicUrl = String(req.body?.url || '').replace(/\/+$/, '');
    if (!/^https:\/\//.test(publicUrl)) {
      return res.status(400).json({ error: 'آدرس وب‌هوک باید با https شروع شود.' });
    }
    const secret = webhookSecret();
    await client.setWebhook(`${publicUrl}/api/bale/hook/${secret}`, { secretToken: secret });
    return res.json({ ok: true, message: 'وب‌هوک تنظیم شد.' });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'تنظیم وب‌هوک ناموفق بود.' });
  }
});

router.get('/bale/webhook-info', async (req, res) => {
  try {
    const client = clientOrThrow();
    const info = await client.call('getWebhookInfo', {});
    return res.json({ ok: true, info });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

function webhookSecret() {
  const token = store.getSettings({ mask: false }).baleToken || process.env.BALE_BOT_TOKEN || 'no-token';
  return crypto.createHash('sha256').update(`hoghooghyar:${token}`).digest('hex').slice(0, 24);
}

/* وب‌هوک بله — بدون احراز هویت پنل، با secret در مسیر و هدر */
router.post('/bale/hook/:secret', async (req, res) => {
  if (req.params.secret !== webhookSecret()) return res.status(404).end();
  const headerSecret = req.get('x-telegram-bot-api-secret-token');
  if (headerSecret && headerSecret !== webhookSecret()) return res.status(403).end();

  res.json({ ok: true }); // پاسخ سریع، پردازش بعد از آن

  try {
    const reply = await handleUpdate(req.body || {});
    if (reply && reply.chatId) {
      const settings = store.getSettings({ mask: false });
      const token = settings.baleToken || process.env.BALE_BOT_TOKEN;
      if (token) {
        const client = new BaleClient({ token });
        await client.sendMessage(reply.chatId, reply.text).catch((err) => {
          console.error('[bale hook] ارسال پاسخ ناموفق:', err.message);
        });
      }
    }
  } catch (err) {
    console.error('[bale hook]', err.message);
  }
});

router.post('/bale/webhook-url', (req, res) => {
  const base = String(req.body?.url || '').replace(/\/+$/, '');
  res.json({ url: `${base}/api/bale/hook/${webhookSecret()}` });
});

router.post('/bale/send', async (req, res) => {
  try {
    const body = req.body || {};
    const result = await sendPeriodPayslips({
      period: body.period,
      employeeIds: body.employeeIds,
      dryRun: Boolean(body.dryRun),
      force: Boolean(body.force),
      short: Boolean(body.short),
    });
    return res.json(result);
  } catch (err) {
    const status = err instanceof BaleError ? 400 : 500;
    return res.status(status).json({ error: err.message || 'ارسال ناموفق بود.' });
  }
});

router.get('/bale/deliveries', (req, res) => {
  res.json({ deliveries: store.listDeliveries({ period: req.query.period, limit: 300 }) });
});

/* ----------------------------------- خروجی ----------------------------------- */

const csvCell = (value) => {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

router.get('/export/:key.csv', (req, res) => {
  const parsed = parsePeriod(req.params.key);
  if (!parsed) return res.status(400).json({ error: 'دوره‌ی نامعتبر است.' });
  const key = periodKey(parsed.jy, parsed.jm);
  const rules = store.getRules();
  const inputs = store.getPeriodInputs(key);
  const employees = store.listEmployees({ includeInactive: false });
  const { items, totals } = calculatePeriod(employees, inputs, rules);

  const header = [
    'کد پرسنلی', 'نام', 'سِمَت', 'روز کارکرد', 'غیبت', 'اضافه‌کاری (ساعت)',
    'حقوق پایه', 'اضافه‌کاری', 'حق مسکن', 'بن خواربار', 'حق اولاد', 'سایر مزایا',
    'جمع پرداختی', 'بیمه سهم کارگر', 'مالیات', 'سایر کسورات', 'خالص پرداختی',
    'بیمه کارفرما', 'هزینه کل کارفرما',
  ];
  const rows = items.map((item) => {
    const get = (key2) => item.earnings.find((e) => e.key === key2)?.amount || 0;
    const ded = (key2) => item.deductions.find((d) => d.key === key2)?.amount || 0;
    const otherEarnings =
      get('nightShift') + get('holidayWork') + get('seniorityAllowance') +
      get('positionAllowance') + get('missionAllowance') + get('otherAllowances');
    return [
      item.employee.personnelCode,
      item.employee.fullName,
      item.employee.position,
      item.input.effectiveDays,
      item.input.absenceDays,
      item.input.overtimeHours,
      get('baseSalary'),
      get('overtime'),
      get('housingAllowance'),
      get('foodAllowance'),
      get('familyAllowance'),
      otherEarnings,
      item.gross,
      ded('insurance'),
      ded('incomeTax'),
      ded('loanInstallment') + ded('otherDeductions') + ded('unemployment'),
      item.net,
      item.employer.insurance + item.employer.unemployment,
      item.employer.totalCost,
    ];
  });

  const summaryRow = ['جمع کل', '', '', '', '', '', '', '', '', '', '', '', totals.gross, totals.insurance, totals.tax, totals.deductions - totals.insurance - totals.tax, totals.net, '', totals.employerCost];

  const csv = [header, ...rows, summaryRow]
    .map((r) => r.map(csvCell).join(','))
    .join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-${key}.csv"`);
  res.send(`\uFEFF${csv}`);
});

router.get('/export/:key.txt', (req, res) => {
  const parsed = parsePeriod(req.params.key);
  if (!parsed) return res.status(400).json({ error: 'دوره‌ی نامعتبر است.' });
  const key = periodKey(parsed.jy, parsed.jm);
  const rules = store.getRules();
  const inputs = store.getPeriodInputs(key);
  const employees = store.listEmployees({ includeInactive: false });
  const org = store.getOrganization();
  const parts = employees.map((employee) => {
    const payslip = calculatePayslip(employee, inputs[employee.id] || {}, rules);
    return formatPayslipMessage(payslip, { period: key, orgName: org.name, footer: org.footer });
  });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(parts.join('\n\n────────────────\n\n'));
});

router.get('/meta', (req, res) => {
  res.json({ moneyExample: money(1234567) });
});

module.exports = { router, requireAuth, webhookSecret, panelPassword };
