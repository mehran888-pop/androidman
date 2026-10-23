'use strict';

/** قالب‌بندی متن فیش حقوقی برای پیام‌رسان بله (HTML) */

const { periodLabel } = require('./jalali');

const money = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function line(label, value, unit = 'تومان') {
  return `${label}: <b>${money(value)}</b> ${unit}`;
}

/**
 * متن فیش حقوقی برای ارسال در بله.
 * @param {object} payslip خروجی calculatePayslip
 * @param {object} ctx { period: '1404-07', orgName }
 */
function formatPayslipMessage(payslip, ctx = {}) {
  const { jy, jm } = parsePeriodSafe(ctx.period);
  const period = jy ? periodLabel(jy, jm) : (ctx.periodLabel || '—');
  const name = escapeHtml(payslip.employee.fullName || 'همکار گرامی');
  const code = escapeHtml(payslip.employee.personnelCode || '—');
  const position = payslip.employee.position ? escapeHtml(payslip.employee.position) : '';
  const org = ctx.orgName ? escapeHtml(ctx.orgName) : '';

  const earningLines = payslip.earnings
    .map((e) => `• ${escapeHtml(e.label)}: <b>${money(e.amount)}</b>`)
    .join('\n');
  const deductionLines = payslip.deductions.length
    ? payslip.deductions.map((d) => `• ${escapeHtml(d.label)}: <b>${money(d.amount)}</b>`).join('\n')
    : '• بدون کسورات';

  const input = payslip.input || {};
  const workLine = `کارکرد: ${input.effectiveDays ?? input.daysWorked} روز` +
    (input.overtimeHours ? ` | اضافه‌کاری: ${input.overtimeHours} ساعت` : '') +
    (input.nightHours ? ` | شب‌کاری: ${input.nightHours} ساعت` : '');

  return [
    org ? `<b>${org}</b>` : null,
    '🧾 <b>فیش حقوقی</b>',
    `👤 ${name}${position ? ` — ${position}` : ''}`,
    `🆔 کد پرسنلی: <code>${code}</code>`,
    `📅 دوره: <b>${escapeHtml(period)}</b>`,
    `⏱ ${escapeHtml(workLine)}`,
    '',
    '<b>مزایا و پرداختی‌ها</b>',
    earningLines || '—',
    '━━━━━━━━━━━━━',
    `جمع پرداختی‌ها: <b>${money(payslip.gross)}</b> تومان`,
    '',
    '<b>کسورات</b>',
    deductionLines,
    '━━━━━━━━━━━━━',
    `جمع کسورات: <b>${money(payslip.gross - payslip.net)}</b> تومان`,
    '',
    `💰 <b>خالص پرداختی: ${money(payslip.net)} تومان</b>`,
    ctx.footer ? `\n<i>${escapeHtml(ctx.footer)}</i>` : '',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

function parsePeriodSafe(period) {
  const { parsePeriod } = require('./jalali');
  return parsePeriod(period) || {};
}

/** پیام خلاصه‌ی دوره برای مدیر */
function formatPeriodSummary(summary, ctx = {}) {
  const { jy, jm } = parsePeriodSafe(ctx.period);
  const period = jy ? periodLabel(jy, jm) : ctx.period;
  return [
    '📊 <b>خلاصه‌ی حقوق و دستمزد</b>',
    ctx.orgName ? `🏢 ${escapeHtml(ctx.orgName)}` : null,
    `📅 دوره: <b>${escapeHtml(period)}</b>`,
    `👥 تعداد پرسنل: <b>${summary.headcount}</b>`,
    '━━━━━━━━━━━━━',
    line('جمع پرداختی‌ها', summary.gross),
    line('بیمه سهم کارگر', summary.insurance),
    line('مالیات', summary.tax),
    line('جمع کسورات', summary.deductions),
    line('خالص پرداختی', summary.net),
    '━━━━━━━━━━━━━',
    line('هزینه‌ی کل کارفرما', summary.employerCost),
  ]
    .filter(Boolean)
    .join('\n');
}

/** پیام فیش کوتاه (بدون جزئیات) */
function formatShortPayslip(payslip, ctx = {}) {
  const { jy, jm } = parsePeriodSafe(ctx.period);
  const period = jy ? periodLabel(jy, jm) : ctx.period;
  return [
    '🧾 <b>فیش حقوقی</b>',
    `👤 ${escapeHtml(payslip.employee.fullName)}`,
    `📅 ${escapeHtml(period)}`,
    `جمع پرداختی: <b>${money(payslip.gross)}</b> تومان`,
    `کسورات: <b>${money(payslip.gross - payslip.net)}</b> تومان`,
    `💰 <b>خالص: ${money(payslip.net)} تومان</b>`,
  ].join('\n');
}

module.exports = { formatPayslipMessage, formatPeriodSummary, formatShortPayslip, money, escapeHtml };
