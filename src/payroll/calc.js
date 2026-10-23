'use strict';

const { EARNING_META, DEDUCTION_META, mergeRules } = require('./rules');

const num = (value, fallback = 0) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(String(value).replace(/[,٬\s]/g, '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  return Number.isFinite(n) ? n : fallback;
};

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

function roundTo(value, step) {
  const s = num(step, 0);
  if (!s || s <= 0) return Math.round(value);
  return Math.round(value / s) * s;
}

/** مالیات پله‌ای ماهانه */
function progressiveTax(taxableIncome, brackets) {
  let income = Math.max(0, taxableIncome);
  let tax = 0;
  let lower = 0;
  for (const bracket of brackets) {
    const upper = bracket.upTo === null || bracket.upTo === undefined ? Infinity : num(bracket.upTo, Infinity);
    const slice = Math.min(income, upper - lower);
    if (slice <= 0) break;
    tax += slice * num(bracket.rate, 0);
    income -= slice;
    lower = upper;
    if (income <= 0) break;
  }
  return tax;
}

function normalizeInputs(employee = {}, raw = {}) {
  const src = { ...employee, ...raw };
  const childrenRaw = src.children !== undefined ? src.children : src.childrenCount;
  return {
    daysWorked: clamp(num(src.daysWorked, num(src.workingDays, 30)), 0, 31),
    absenceDays: clamp(num(src.absenceDays, 0), 0, 31),
    overtimeHours: Math.max(0, num(src.overtimeHours, 0)),
    nightHours: Math.max(0, num(src.nightHours, 0)),
    holidayHours: Math.max(0, num(src.holidayHours, 0)),
    baseSalary: Math.max(0, num(src.baseSalary, num(src.monthlyBaseSalary, 0))),
    housingAllowance: Math.max(0, num(src.housingAllowance, NaN)),
    foodAllowance: Math.max(0, num(src.foodAllowance, NaN)),
    seniorityAllowance: Math.max(0, num(src.seniorityAllowance, 0)),
    positionAllowance: Math.max(0, num(src.positionAllowance, 0)),
    missionAllowance: Math.max(0, num(src.missionAllowance, 0)),
    otherAllowances: Math.max(0, num(src.otherAllowances, 0)),
    children: clamp(num(childrenRaw, 0), 0, 20),
    loanInstallment: Math.max(0, num(src.loanInstallment, 0)),
    otherDeductions: Math.max(0, num(src.otherDeductions, 0)),
  };
}

/**
 * محاسبه‌ی کامل فیش حقوقی یک نفر.
 * @param {object} employee اطلاعات پرسنلی (نام، کد، نرخ‌های پیش‌فرض)
 * @param {object} raw ورودی‌های ماه (کارکرد، اضافه‌کاری، ...)
 * @param {object} rules نرخ‌های حقوق و دستمزد
 */
function calculatePayslip(employee = {}, raw = {}, rulesInput = {}) {
  const rules = mergeRules(rulesInput);
  const input = normalizeInputs(employee, raw);
  const warnings = [];
  const step = num(rules.roundTo, 0);

  const monthDays = num(rules.standardMonthDays, 30) || 30;
  const monthlyHours = num(rules.monthlyHours, 220) || 220;
  const effectiveDays = Math.max(0, input.daysWorked - input.absenceDays);
  if (input.daysWorked + input.absenceDays > 31) {
    warnings.push('مجموع کارکرد و غیبت بیش از ۳۱ روز است.');
  }
  if (input.baseSalary <= 0) warnings.push('حقوق پایه تعیین نشده است.');

  const dailyRate = input.baseSalary / monthDays;
  const hourlyRate = input.baseSalary / monthlyHours;

  const basePay = dailyRate * effectiveDays;
  const overtimePay = input.overtimeHours * hourlyRate * num(rules.overtimeMultiplier, 1.4);
  const nightPay = input.nightHours * hourlyRate * num(rules.nightPremiumRate, 0.35);
  const holidayPay = input.holidayHours * hourlyRate * num(rules.holidayMultiplier, 1.4);

  const proration = rules.prorateAllowances ? effectiveDays / monthDays : 1;
  const housing = Number.isFinite(input.housingAllowance)
    ? input.housingAllowance
    : num(rules.housingAllowance, 0);
  const food = Number.isFinite(input.foodAllowance) ? input.foodAllowance : num(rules.foodAllowance, 0);

  const children = Math.min(input.children, num(rules.childrenCap, 4) || 4);
  const perChild = rules.familyAllowanceAuto
    ? 3 * (num(rules.minimumMonthlyWage, 0) / monthDays)
    : num(rules.familyAllowancePerChild, 0);
  const familyAllowance = perChild * children;

  const earningLines = [
    { key: 'baseSalary', amount: basePay },
    { key: 'overtime', amount: overtimePay },
    { key: 'nightShift', amount: nightPay },
    { key: 'holidayWork', amount: holidayPay },
    { key: 'housingAllowance', amount: housing * proration },
    { key: 'foodAllowance', amount: food * proration },
    { key: 'familyAllowance', amount: familyAllowance },
    { key: 'seniorityAllowance', amount: input.seniorityAllowance },
    { key: 'positionAllowance', amount: input.positionAllowance },
    { key: 'missionAllowance', amount: input.missionAllowance },
    { key: 'otherAllowances', amount: input.otherAllowances },
  ];

  const earnings = earningLines
    .map((line) => {
      const meta = EARNING_META[line.key];
      const amount = roundTo(line.amount, step);
      return {
        key: line.key,
        label: meta.label,
        amount,
        insurable: meta.insurable,
        taxable: meta.taxable && !(line.key === 'missionAllowance' && rules.taxFreeMission),
      };
    })
    .filter((line) => line.amount > 0);

  const gross = earnings.reduce((sum, line) => sum + line.amount, 0);

  let insuranceBase = earnings.filter((l) => l.insurable).reduce((s, l) => s + l.amount, 0);
  const ceilingMultiplier = num(rules.insuranceCeilingMultiplier, 0);
  const insuranceCeiling = ceilingMultiplier > 0
    ? num(rules.minimumMonthlyWage, 0) * ceilingMultiplier
    : Infinity;
  if (insuranceBase > insuranceCeiling) {
    insuranceBase = roundTo(insuranceCeiling, step);
    warnings.push('مزد مشمول بیمه به سقف بیمه‌ای محدود شد.');
  }

  const employeeInsurance = roundTo(insuranceBase * num(rules.employeeInsuranceRate, 0.07), step);
  const employeeUnemployment = roundTo(insuranceBase * num(rules.employeeUnemploymentRate, 0), step);
  const employerInsurance = roundTo(insuranceBase * num(rules.employerInsuranceRate, 0.2), step);
  const employerUnemployment = roundTo(insuranceBase * num(rules.employerUnemploymentRate, 0.02), step);

  const taxableGross = earnings.filter((l) => l.taxable).reduce((s, l) => s + l.amount, 0);
  const taxDeduction = rules.insuranceOnTaxable ? employeeInsurance : 0;
  const taxableIncome = Math.max(0, taxableGross - taxDeduction);
  const incomeTax = roundTo(progressiveTax(taxableIncome, rules.taxBrackets || []), step);

  const deductionLines = [
    { key: 'insurance', amount: employeeInsurance },
    { key: 'unemployment', amount: employeeUnemployment },
    { key: 'incomeTax', amount: incomeTax },
    { key: 'loanInstallment', amount: input.loanInstallment },
    { key: 'otherDeductions', amount: input.otherDeductions },
  ];
  const deductions = deductionLines
    .map((line) => ({ key: line.key, label: DEDUCTION_META[line.key].label, amount: roundTo(line.amount, step) }))
    .filter((line) => line.amount > 0);

  const totalDeductions = deductions.reduce((sum, line) => sum + line.amount, 0);
  const net = gross - totalDeductions;

  const firstZeroBracket = (rules.taxBrackets || []).find((b) => num(b.rate, 1) === 0);

  return {
    employee: {
      id: employee.id || null,
      personnelCode: employee.personnelCode || '',
      fullName: employee.fullName || '',
      position: employee.position || '',
      department: employee.department || '',
    },
    input: { ...input, effectiveDays, childrenInsured: children },
    earnings,
    deductions,
    gross,
    insuranceBase,
    taxableIncome,
    net,
    employer: {
      insurance: employerInsurance,
      unemployment: employerUnemployment,
      total: employerInsurance + employerUnemployment,
      totalCost: gross + employerInsurance + employerUnemployment,
    },
    rates: {
      dailyRate: Math.round(dailyRate),
      hourlyRate: Math.round(hourlyRate),
      overtimeRate: Math.round(hourlyRate * num(rules.overtimeMultiplier, 1.4)),
      nightRate: Math.round(hourlyRate * num(rules.nightPremiumRate, 0.35)),
      insuranceCeiling: Number.isFinite(insuranceCeiling) ? roundTo(insuranceCeiling, step) : null,
      familyAllowancePerChild: Math.round(perChild),
      taxExemption: firstZeroBracket ? num(firstZeroBracket.upTo, 0) : num(rules.taxExemptionMonthly, 0),
    },
    warnings,
  };
}

/** محاسبه‌ی یک دوره برای چند نفر + جمع‌بندی */
function calculatePeriod(employees, inputsByEmployee, rules) {
  const items = employees.map((employee) => {
    const raw = inputsByEmployee?.[employee.id] || {};
    return {
      employeeId: employee.id,
      ...calculatePayslip(employee, raw, rules),
      inputs: normalizeInputs(employee, raw),
    };
  });
  const totals = items.reduce(
    (acc, item) => ({
      gross: acc.gross + item.gross,
      net: acc.net + item.net,
      deductions: acc.deductions + (item.gross - item.net),
      insurance: acc.insurance + (item.deductions.find((d) => d.key === 'insurance')?.amount || 0),
      tax: acc.tax + (item.deductions.find((d) => d.key === 'incomeTax')?.amount || 0),
      employerCost: acc.employerCost + item.employer.totalCost,
    }),
    { gross: 0, net: 0, deductions: 0, insurance: 0, tax: 0, employerCost: 0 },
  );
  return { items, totals: { ...totals, headcount: items.length } };
}

module.exports = { calculatePayslip, calculatePeriod, progressiveTax, normalizeInputs, num, roundTo };
