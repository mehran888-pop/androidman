'use strict';

/**
 * قواعد پیش‌فرض حقوق و دستمزد.
 *
 * ⚠️ مهم: اعداد زیر «نمونه» و بر مبنای مصوبات سال ۱۴۰۴ هستند.
 * هر سال باید حداقل حقوق، حق مسکن، بن خواربار، حق اولاد، سقف معافیت و
 * پله‌های مالیات را از بخشنامه‌ی سال جاری به‌روزرسانی کنید (از صفحه‌ی «تنظیمات»).
 * همه‌ی مبالغ در این نرم‌افزار «تومان» است.
 */

const { YEAR_PRESETS, LATEST_YEAR } = require('./presets');

const MONTHLY_TAX_BRACKETS_1404 = YEAR_PRESETS[1404].taxBrackets;
const CURRENT = YEAR_PRESETS[LATEST_YEAR];

const DEFAULT_RULES = {
  year: CURRENT.year,
  currency: 'تومان',

  // مزایای پایه (نرخ‌های سال جاری از presets.js)
  minimumMonthlyWage: CURRENT.minimumMonthlyWage, // حداقل حقوق ماهانه
  housingAllowance: CURRENT.housingAllowance, // حق مسکن
  foodAllowance: CURRENT.foodAllowance, // بن خواربار
  familyAllowancePerChild: CURRENT.familyAllowancePerChild,
  familyAllowanceAuto: true,
  childrenCap: 4,

  // زمان کار
  monthlyHours: 220, // ساعت کاری ماهانه برای محاسبه مزد ساعتی
  standardMonthDays: 30,
  overtimeMultiplier: 1.4, // ۴۰٪ اضافه بر مزد عادی
  nightPremiumRate: 0.35, // ۳۵٪ فوق‌العاده شب‌کاری
  holidayMultiplier: 1.4,

  // بیمه (تأمین اجتماعی)
  employeeInsuranceRate: 0.07,
  employerInsuranceRate: 0.2,
  employeeUnemploymentRate: 0,
  employerUnemploymentRate: CURRENT.employerUnemploymentRate,
  insuranceCeilingMultiplier: 7, // سقف مزد بیمه = ۷ برابر حداقل مزد روزانه (۰ = بدون سقف)
  insuranceOnTaxable: true, // حق بیمه‌ی سهم کارگر از درآمد مشمول مالیات کسر می‌شود

  // مالیات بر درآمد حقوق
  taxBrackets: CURRENT.taxBrackets.map((b) => ({ ...b })),
  taxExemptionMonthly: CURRENT.taxExemptionMonthly,
  taxFreeMission: true,

  // رفتار اقلام
  prorateAllowances: false, // آیا حق مسکن/بن با کارکرد تقلیل پیدا کند؟
  roundTo: 1000, // گرد کردن مبالغ به نزدیک‌ترین هزار تومان
};

const EARNING_META = {
  baseSalary: { label: 'حقوق پایه', insurable: true, taxable: true },
  overtime: { label: 'فوق‌العاده اضافه‌کاری', insurable: true, taxable: true },
  nightShift: { label: 'فوق‌العاده شب‌کاری', insurable: true, taxable: true },
  holidayWork: { label: 'فوق‌العاده کار در تعطیل', insurable: true, taxable: true },
  housingAllowance: { label: 'حق مسکن', insurable: true, taxable: true },
  foodAllowance: { label: 'بن خواربار', insurable: true, taxable: false },
  familyAllowance: { label: 'حق اولاد', insurable: false, taxable: false },
  seniorityAllowance: { label: 'پایه سنوات', insurable: true, taxable: true },
  positionAllowance: { label: 'حق پست / مسئولیت', insurable: true, taxable: true },
  missionAllowance: { label: 'فوق‌العاده مأموریت', insurable: false, taxable: false },
  otherAllowances: { label: 'سایر مزایا', insurable: true, taxable: true },
};

const DEDUCTION_META = {
  insurance: { label: 'بیمه تأمین اجتماعی (سهم کارگر)' },
  unemployment: { label: 'بیمه بیکاری (سهم کارگر)' },
  incomeTax: { label: 'مالیات بر درآمد حقوق' },
  loanInstallment: { label: 'قسط وام' },
  otherDeductions: { label: 'سایر کسورات' },
};

/** ادغام نرخ‌های ذخیره‌شده با پیش‌فرض‌ها تا فیلدهای جدید همیشه موجود باشند */
function mergeRules(rules = {}) {
  const merged = { ...DEFAULT_RULES, ...(rules || {}) };
  merged.taxBrackets = Array.isArray(rules?.taxBrackets) && rules.taxBrackets.length
    ? rules.taxBrackets.map((b) => ({ upTo: b.upTo === null || b.upTo === '' ? null : Number(b.upTo), rate: Number(b.rate) }))
    : DEFAULT_RULES.taxBrackets.map((b) => ({ ...b }));
  if (!Number.isFinite(merged.taxExemptionMonthly)) merged.taxExemptionMonthly = 0;
  return merged;
}

module.exports = {
  DEFAULT_RULES,
  EARNING_META,
  DEDUCTION_META,
  MONTHLY_TAX_BRACKETS_1404,
  mergeRules,
};
