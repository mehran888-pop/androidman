'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { calculatePayslip, progressiveTax } = require('../src/payroll/calc');
const { mergeRules, DEFAULT_RULES } = require('../src/payroll/rules');

const rules = mergeRules({});

const baseEmployee = { fullName: 'تست تستی', personnelCode: '9001', baseSalary: 30000000 };

test('محاسبه‌ی پایه: حقوق ثابت ۳۰ روز با مزایای مصوب', () => {
  const r = calculatePayslip(baseEmployee, {}, rules);
  const expected = 30000000 + rules.housingAllowance + rules.foodAllowance;
  assert.equal(r.gross, Math.round(expected / 1000) * 1000);
  assert.ok(r.net < r.gross);
  assert.equal(r.warnings.length, 0);
});

test('کارکرد ناقص، حقوق پایه را به نسبت روز کاهش می‌دهد', () => {
  const full = calculatePayslip(baseEmployee, { daysWorked: 30 }, rules);
  const half = calculatePayslip(baseEmployee, { daysWorked: 15 }, rules);
  const baseLine = (r) => r.earnings.find((e) => e.key === 'baseSalary').amount;
  assert.equal(baseLine(half), Math.round(baseLine(full) / 2 / 1000) * 1000);
});

test('غیبت از کارکرد کم می‌شود', () => {
  const r = calculatePayslip(baseEmployee, { daysWorked: 30, absenceDays: 3 }, rules);
  assert.equal(r.input.effectiveDays, 27);
  const baseLine = r.earnings.find((e) => e.key === 'baseSalary').amount;
  assert.equal(baseLine, 27000000);
});

test('اضافه‌کاری با ضریب ۱.۴ و نرخ ساعتی درست', () => {
  const r = calculatePayslip(baseEmployee, { overtimeHours: 10 }, rules);
  const hourly = 30000000 / rules.monthlyHours;
  const expected = Math.round((10 * hourly * 1.4) / 1000) * 1000;
  assert.equal(r.earnings.find((e) => e.key === 'overtime').amount, expected);
});

test('حق اولاد خودکار = ۳ برابر مزد روزانه‌ی حداقل به‌ازای هر فرزند', () => {
  const r = calculatePayslip(baseEmployee, { children: 3 }, rules);
  const total = Math.round((3 * (rules.minimumMonthlyWage / 30) * 3) / 1000) * 1000;
  assert.equal(r.earnings.find((e) => e.key === 'familyAllowance').amount, total);
});

test('سقف فرزند رعایت می‌شود', () => {
  const r = calculatePayslip(baseEmployee, { children: 12 }, rules);
  const line = r.earnings.find((e) => e.key === 'familyAllowance').amount;
  const total = Math.round((3 * (rules.minimumMonthlyWage / 30) * rules.childrenCap) / 1000) * 1000;
  assert.equal(line, total);
});

test('بن خواربار مشمول بیمه است ولی معاف از مالیات', () => {
  const r = calculatePayslip(baseEmployee, {}, rules);
  const food = r.earnings.find((e) => e.key === 'foodAllowance');
  assert.equal(food.taxable, false);
  assert.equal(food.insurable, true);
});

test('مأموریت معاف از بیمه و مالیات است', () => {
  const r = calculatePayslip(baseEmployee, { missionAllowance: 2000000 }, rules);
  const mission = r.earnings.find((e) => e.key === 'missionAllowance');
  assert.equal(mission.taxable, false);
  assert.equal(mission.insurable, false);
});

test('مالیات پله‌ای درست محاسبه می‌شود (پله‌های ۱۴۰۵)', () => {
  const brackets = [
    { upTo: 40000000, rate: 0 },
    { upTo: 80000000, rate: 0.1 },
    { upTo: 100000000, rate: 0.15 },
    { upTo: 120000000, rate: 0.2 },
    { upTo: 140000000, rate: 0.25 },
    { upTo: null, rate: 0.3 },
  ];
  assert.equal(progressiveTax(35000000, brackets), 0); // زیر سقف معافیت
  assert.equal(progressiveTax(80000000, brackets), 4000000); // ۱۰٪ × ۴۰ میلیون
  assert.equal(progressiveTax(100000000, brackets), 7000000); // + ۱۵٪ × ۲۰ میلیون
  assert.equal(progressiveTax(150000000, brackets), 19000000); // + ۲۰٪، ۲۵٪ و ۳۰٪ پله آخر
  assert.equal(progressiveTax(0, brackets), 0);
});

test('نرخ‌های پیش‌فرض مربوط به سال جاری (۱۴۰۵) است', () => {
  assert.equal(DEFAULT_RULES.year, 1405);
  assert.equal(DEFAULT_RULES.minimumMonthlyWage, 16625550);
  assert.equal(DEFAULT_RULES.taxBrackets[0].upTo, 40000000);
});

test('بیمه‌ی سهم کارگر ۷٪ مأخذ مشمول است و به سقف محدود می‌شود', () => {
  const r = calculatePayslip({ ...baseEmployee, baseSalary: 900000000 }, {}, rules);
  assert.equal(
    r.rates.insuranceCeiling,
    Math.round((rules.minimumMonthlyWage * rules.insuranceCeilingMultiplier) / 1000) * 1000,
  );
  assert.equal(r.insuranceBase, r.rates.insuranceCeiling);
  assert.ok(r.warnings.some((w) => w.includes('سقف بیمه')));
});

test('حق بیمه از درآمد مشمول مالیات کسر می‌شود', () => {
  const employee = { ...baseEmployee, baseSalary: 40000000 };
  const withDeduction = calculatePayslip(employee, {}, mergeRules({ insuranceOnTaxable: true }));
  const withoutDeduction = calculatePayslip(employee, {}, mergeRules({ insuranceOnTaxable: false }));
  assert.ok(withDeduction.taxableIncome < withoutDeduction.taxableIncome);
});

test('تقلیل مزایای ثابت با کارکرد (در صورت فعال بودن)', () => {
  const r = calculatePayslip(baseEmployee, { daysWorked: 15 }, mergeRules({ prorateAllowances: true }));
  const housing = r.earnings.find((e) => e.key === 'housingAllowance').amount;
  assert.equal(housing, Math.round(rules.housingAllowance / 2 / 1000) * 1000);
});

test('خالص = جمع پرداختی‌ها منهای کسورات', () => {
  const r = calculatePayslip(
    baseEmployee,
    { overtimeHours: 12, loanInstallment: 3000000, otherDeductions: 500000 },
    rules,
  );
  const deductions = r.deductions.reduce((s, d) => s + d.amount, 0);
  assert.equal(r.net, r.gross - deductions);
  assert.ok(r.deductions.some((d) => d.key === 'loanInstallment'));
});

test('هزینه‌ی کارفرما شامل بیمه و بیمه بیکاری است', () => {
  const r = calculatePayslip(baseEmployee, {}, rules);
  assert.ok(r.employer.total > 0);
  assert.equal(r.employer.totalCost, r.gross + r.employer.insurance + r.employer.unemployment);
});

test('نرخ‌های سفارشی روی محاسبه اثر می‌گذارند', () => {
  const custom = mergeRules({ employeeInsuranceRate: 0.1, housingAllowance: 1000000 });
  const r = calculatePayslip(baseEmployee, {}, custom);
  assert.equal(r.earnings.find((e) => e.key === 'housingAllowance').amount, 1000000);
  assert.equal(
    r.deductions.find((d) => d.key === 'insurance').amount,
    Math.round((r.insuranceBase * 0.1) / 1000) * 1000,
  );
});

test('مبالغ با ارقام فارسی و جداکننده هم خوانده می‌شوند', () => {
  const r = calculatePayslip(baseEmployee, { baseSalary: '۲۵,۰۰۰,۰۰۰' }, rules);
  assert.equal(r.input.baseSalary, 25000000);
});

test('ورودی نامعتبر باعث خطا نمی‌شود و هشدار می‌دهد', () => {
  const r = calculatePayslip({ fullName: 'x' }, { baseSalary: '', overtimeHours: 'abc' }, rules);
  assert.equal(r.gross >= 0, true);
  assert.ok(r.warnings.some((w) => w.includes('حقوق پایه')));
});
