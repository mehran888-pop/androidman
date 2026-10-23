'use strict';

/**
 * منطق دستورات ربات بله — مشترک بین وب‌هوک و long-polling.
 */

const store = require('../store');
const { calculatePayslip } = require('../payroll/calc');
const { calculatePeriod } = require('../payroll/calc');
const {
  formatPayslipMessage,
  formatPeriodSummary,
  money,
  escapeHtml,
} = require('../payroll/payslip-text');
const {
  todayJalali,
  periodKey,
  periodLabel,
  parsePeriod,
  recentPeriods,
} = require('../payroll/jalali');

const HELP_TEXT = [
  '👋 به <b>حقوق‌یار</b> خوش آمدید.',
  '',
  '<b>دستورات کارمند</b>',
  '/link کدپرسنلی کدملی — اتصال حساب بله به پرونده (۴ رقم آخر کد ملی)',
  '/payslip — دریافت فیش حقوقی ماه جاری',
  '/payslip 1404-06 — دریافت فیش یک ماه مشخص',
  '/unlink — قطع اتصال',
  '',
  '<b>دستورات مدیر</b>',
  '/id — نمایش شناسه‌ی چت شما',
  '/list — فهرست پرسنل',
  '/summary — خلاصه‌ی حقوق ماه جاری',
  '/send — ارسال فیش‌ها به همه‌ی پرسنل',
  '/send 1404-06 — ارسال فیش‌های یک ماه مشخص',
  '/help — راهنما',
].join('\n');

function currentPeriod(now = new Date()) {
  const { jy, jm } = todayJalali(now);
  return periodKey(jy, jm);
}

function isManagerChat(chatId) {
  const settings = store.getSettings({ mask: false });
  return String(settings.baleChatId || '').trim() === String(chatId ?? '').trim();
}

function parseCommand(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return null;
  const [head, ...rest] = raw.split(/\s+/);
  const command = head.replace(/^\//, '').split('@')[0].toLowerCase();
  return { command, args: rest, raw };
}

function resolveEmployee(chatId) {
  return store.findEmployeeByChatId(chatId);
}

function buildPayslipText(employee, period) {
  const rules = store.getRules();
  const inputs = store.getPeriodInputs(period);
  const payslip = calculatePayslip(employee, inputs[employee.id] || {}, rules);
  const organization = store.getOrganization();
  return formatPayslipMessage(payslip, {
    period,
    orgName: organization.name,
    footer: organization.footer,
  });
}

function employeeListText() {
  const employees = store.listEmployees({ includeInactive: false });
  if (!employees.length) return 'هنوز پرسنلی ثبت نشده است.';
  const rows = employees.slice(0, 60).map((e, i) =>
    `${i + 1}. ${escapeHtml(e.fullName)} — کد ${escapeHtml(e.personnelCode || '—')}` +
    (e.baleChatId ? ' ✅' : ' ⚠️'));
  return [
    `<b>فهرست پرسنل (${employees.length} نفر)</b>`,
    ...rows,
    '',
    '✅ = حساب بله متصل شده',
  ].join('\n');
}

/**
 * پردازش یک دستور. خروجی: { text } یا { text, sendPayslips: true }
 */
async function handleUpdate(update) {
  const message = update?.message;
  if (!message) return null;
  const chatId = message.chat?.id;
  const text = message.text || '';
  const parsed = parseCommand(text);
  if (!parsed) {
    if (/^(سلام|درود|hi|hello)$/i.test(text.trim())) {
      return { chatId, text: 'سلام 👋 برای دیدن دستورات /help را بفرستید.' };
    }
    return { chatId, text: 'متوجه نشدم. برای دیدن دستورات /help را بفرستید.' };
  }

  const { command, args } = parsed;
  const employee = resolveEmployee(chatId);
  const manager = isManagerChat(chatId);
  const org = store.getOrganization();

  switch (command) {
    case 'start':
      return { chatId, text: `به <b>${escapeHtml(org.name)}</b> خوش آمدید.\n\n${HELP_TEXT}` };

    case 'help':
      return { chatId, text: HELP_TEXT };

    case 'id':
      return {
        chatId,
        text: `🆔 شناسه‌ی چت شما: <code>${escapeHtml(String(chatId))}</code>\n` +
          'این شناسه را در تنظیمات برنامه به‌عنوان «Chat ID مدیر» وارد کنید تا خلاصه‌ها و ارسال گروهی فعال شود.',
      };

    case 'link': {
      const [codeRaw, nationalRaw] = args;
      if (!codeRaw) {
        return { chatId, text: 'قالب درست: <code>/link 1001 1234</code>\nکد پرسنلی و ۴ رقم آخر کد ملی.' };
      }
      const target = store.findEmployeeByCode(codeRaw);
      if (!target) {
        return { chatId, text: 'پرونده‌ای با این کد پرسنلی پیدا نشد. با واحد اداری تماس بگیرید.' };
      }
      const nationalId = String(target.nationalId || '').trim();
      if (nationalId) {
        const expected = nationalId.slice(-4);
        if (String(nationalRaw || '').trim() !== expected) {
          return { chatId, text: '۴ رقم آخر کد ملی مطابقت ندارد.' };
        }
      }
      const alreadyLinked = store.findEmployeeByChatId(chatId);
      if (alreadyLinked && alreadyLinked.id !== target.id) {
        return { chatId, text: 'این حساب بله قبلاً به پرونده‌ی دیگری متصل شده است. ابتدا /unlink بزنید.' };
      }
      store.setEmployeeChatId(target.id, String(chatId));
      return {
        chatId,
        text: `✅ حساب شما به پرونده‌ی <b>${escapeHtml(target.fullName)}</b> متصل شد.\n` +
          'از این پس با /payslip فیش حقوقی خود را دریافت می‌کنید.',
      };
    }

    case 'unlink': {
      if (!employee) return { chatId, text: 'حساب شما متصل نبود.' };
      store.setEmployeeChatId(employee.id, '');
      return { chatId, text: 'اتصال حساب شما قطع شد.' };
    }

    case 'payslip': {
      if (!employee) {
        return {
          chatId,
          text: 'حساب شما به پرونده‌ی پرسنلی متصل نیست.\n' +
            'دستور <code>/link کدپرسنلی کدملی</code> را بفرستید یا با مدیر تماس بگیرید.',
        };
      }
      let period = currentPeriod();
      if (args[0]) {
        const p = parsePeriod(args[0]);
        if (!p) return { chatId, text: 'قالب دوره: <code>1404-06</code>' };
        period = periodKey(p.jy, p.jm);
      }
      return { chatId, text: buildPayslipText(employee, period) };
    }

    case 'list':
    case 'summary':
    case 'send': {
      if (!manager) {
        return { chatId, text: '⛔️ این دستور فقط برای مدیر سازمان فعال است.' };
      }
      let period = currentPeriod();
      if (args[0]) {
        const p = parsePeriod(args[0]);
        if (!p) return { chatId, text: 'قالب دوره: <code>1404-06</code>' };
        period = periodKey(p.jy, p.jm);
      }

      if (command === 'list') return { chatId, text: employeeListText() };

      if (command === 'summary') {
        const rules = store.getRules();
        const inputs = store.getPeriodInputs(period);
        const employees = store.listEmployees({ includeInactive: false });
        const { totals } = calculatePeriod(employees, inputs, rules);
        return { chatId, text: formatPeriodSummary(totals, { period, orgName: org.name }) };
      }

      // /send → ارسال گروهی
      const { sendPeriodPayslips } = require('./notify');
      try {
        const result = await sendPeriodPayslips({ period });
        const s = result.summary;
        const p = parsePeriod(period);
        return {
          chatId,
          text: [
            '📤 <b>ارسال فیش‌های دوره</b>',
            `📅 ${escapeHtml(periodLabel(p.jy, p.jm))}`,
            `✅ ارسال‌شده: ${s.sent || 0}`,
            s.failed ? `❌ ناموفق: ${s.failed}` : null,
            s.skipped ? `⚠️ بدون شناسه چت: ${s.skipped}` : null,
            s['already-sent'] ? `ℹ️ قبلاً ارسال شده: ${s['already-sent']}` : null,
            `💰 جمع خالص ارسال‌شده: ${money(s.totalNet)} تومان`,
          ].filter(Boolean).join('\n'),
        };
      } catch (err) {
        return { chatId, text: `❌ ارسال انجام نشد: ${escapeHtml(err.message)}` };
      }
    }

    case 'periods': {
      const list = recentPeriods(6).map((p) => `• <code>${p.key}</code> — ${p.label}`);
      return { chatId, text: `<b>دوره‌های اخیر</b>\n${list.join('\n')}` };
    }

    default:
      return { chatId, text: 'دستور ناشناخته. /help را بفرستید.' };
  }
}

module.exports = { handleUpdate, parseCommand, currentPeriod, isManagerChat, HELP_TEXT };
