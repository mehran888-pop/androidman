'use strict';

const store = require('../store');
const { BaleClient, BaleError } = require('./client');
const { formatPayslipMessage, formatShortPayslip, money } = require('../payroll/payslip-text');
const { calculatePayslip } = require('../payroll/calc');
const { parsePeriod } = require('../payroll/jalali');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildClient(settings) {
  const token = settings?.baleToken || process.env.BALE_BOT_TOKEN || '';
  if (!token) {
    throw new BaleError('توکن ربات بله در تنظیمات وارد نشده است. (بخش «ربات بله»)');
  }
  return new BaleClient({ token, baseUrl: process.env.BALE_API_BASE || undefined });
}

function resolveChatId(employee, settings) {
  return String(employee?.baleChatId || settings?.baleChatId || '').trim();
}

/**
 * ارسال فیش حقوقی یک یا چند نفر در یک دوره.
 * @param {object} opts
 * @param {string} opts.period کلید دوره مثل 1404-07
 * @param {string[]} [opts.employeeIds] فقط این افراد
 * @param {boolean} [opts.dryRun] فقط شبیه‌سازی
 * @param {boolean} [opts.force] ارسال دوباره به کسانی که قبلاً دریافت کرده‌اند
 * @param {boolean} [opts.short] فیش کوتاه
 */
async function sendPeriodPayslips(opts = {}) {
  const {
    period,
    employeeIds,
    dryRun = false,
    force = false,
    short = false,
    onProgress,
  } = opts;

  if (!parsePeriod(period)) throw new BaleError('دوره‌ی نامعتبر است. قالب درست: 1404-07');

  const settings = store.getSettings({ mask: false });
  const rules = store.getRules();
  const organization = store.getOrganization();
  const inputs = store.getPeriodInputs(period);
  let employees = store.listEmployees({ includeInactive: false });
  if (Array.isArray(employeeIds) && employeeIds.length) {
    employees = employees.filter((e) => employeeIds.includes(e.id));
  }

  const client = dryRun ? null : buildClient(settings);
  const results = [];
  const delay = Number(settings.sendDelayMs) || 0;

  for (const employee of employees) {
    const payslip = calculatePayslip(employee, inputs[employee.id] || {}, rules);
    const chatId = resolveChatId(employee, settings);
    const base = {
      employeeId: employee.id,
      fullName: employee.fullName,
      personnelCode: employee.personnelCode,
      net: payslip.net,
      chatId,
    };

    if (!chatId) {
      results.push({ ...base, status: 'skipped', error: 'شناسه چت بله ثبت نشده است.' });
      continue;
    }
    if (!force && store.wasDelivered(period, employee.id)) {
      results.push({ ...base, status: 'already-sent' });
      continue;
    }

    const text = short
      ? formatShortPayslip(payslip, { period })
      : formatPayslipMessage(payslip, { period, orgName: organization.name, footer: organization.footer });

    if (dryRun) {
      results.push({ ...base, status: 'dry-run', preview: text });
      continue;
    }

    try {
      await client.sendMessage(chatId, text, { parseMode: 'HTML' });
      store.addDelivery({ period, employeeId: employee.id, chatId, status: 'sent', net: payslip.net });
      results.push({ ...base, status: 'sent' });
    } catch (err) {
      const message = err instanceof BaleError ? err.message : String(err.message || err);
      store.addDelivery({ period, employeeId: employee.id, chatId, status: 'failed', error: message, net: payslip.net });
      results.push({ ...base, status: 'failed', error: message });
    }

    onProgress?.(results[results.length - 1], results.length, employees.length);
    if (delay) await sleep(delay);
  }

  const summary = results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      if (r.status === 'sent') acc.totalNet += r.net || 0;
      return acc;
    },
    { totalNet: 0 },
  );

  return { period, dryRun, results, summary };
}

/** ارسال یک پیام آزمایشی به مدیر */
async function sendTestMessage(text = '✅ اتصال حقوق‌یار به ربات بله برقرار است.') {
  const settings = store.getSettings({ mask: false });
  const client = buildClient(settings);
  const chatId = String(settings.baleChatId || '').trim();
  if (!chatId) throw new BaleError('شناسه چت مدیر (Chat ID) در تنظیمات وارد نشده است.');
  await client.sendMessage(chatId, text);
  return { chatId, money: money(0) };
}

module.exports = { sendPeriodPayslips, sendTestMessage, buildClient, resolveChatId };
