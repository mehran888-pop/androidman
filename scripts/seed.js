'use strict';

/**
 * داده‌ی نمونه برای تست سریع:
 *   npm run seed
 *   npm run seed -- --force   (پاک‌کردن و ساخت دوباره)
 */

const store = require('../src/store');
const { todayJalali, periodKey, periodLabel } = require('../src/payroll/jalali');

const force = process.argv.includes('--force');
const db = store.load();

if (db.employees.length && !force) {
  console.log(`ℹ️ ${db.employees.length} پرسنل از قبل وجود دارد. برای ساخت دوباره از --force استفاده کنید.`);
  process.exit(0);
}

if (force && db.employees.length) {
  db.employees = [];
  db.periods = {};
  db.deliveries = [];
  store.save();
}

if (!db.organization.name || db.organization.name === 'شرکت نمونه') {
  store.updateOrganization({
    name: 'شرکت نمونه پارس',
    footer: 'این فیش به‌صورت خودکار توسط حقوق‌یار تولید شده است.',
  });
}

const sample = [
  { fullName: 'زهرا محمدی', personnelCode: '1001', nationalId: '0079512345', position: 'کارشناس حسابداری', department: 'مالی', baseSalary: 30000000, children: 1, overtimeHours: 10, seniorityAllowance: 500000 },
  { fullName: 'علی رضایی', personnelCode: '1002', nationalId: '0012345678', position: 'برنامه‌نویس ارشد', department: 'فناوری اطلاعات', baseSalary: 62000000, children: 2, overtimeHours: 6, positionAllowance: 5000000 },
  { fullName: 'مریم حسینی', personnelCode: '1003', nationalId: '0456789123', position: 'مدیر منابع انسانی', department: 'اداری', baseSalary: 55000000, children: 0, nightHours: 4, positionAllowance: 8000000 },
  { fullName: 'محمد کریمی', personnelCode: '1004', nationalId: '0098765432', position: 'کارشناس فروش', department: 'بازاریابی', baseSalary: 38000000, children: 3, overtimeHours: 18, otherAllowances: 3000000, loanInstallment: 2000000 },
  { fullName: 'فاطمه نوری', personnelCode: '1005', nationalId: '0024681357', position: 'کارمند پشتیبانی', department: 'عملیات', baseSalary: 22000000, children: 0, daysWorked: 26, absenceDays: 0 },
];

for (const person of sample) {
  store.createEmployee(person);
}

const now = todayJalali();
const key = periodKey(now.jy, now.jm);
const employees = store.listEmployees();
for (const employee of employees) {
  store.setPeriodInput(key, employee.id, {
    daysWorked: employee.daysWorked,
    overtimeHours: employee.overtimeHours,
    nightHours: employee.nightHours,
    children: employee.children,
    baseSalary: employee.baseSalary,
  });
}
store.flush();

console.log(`✅ ${sample.length} پرسنل نمونه ساخته شد برای دوره‌ی ${periodLabel(now.jy, now.jm)} (${key}).`);
console.log('حالا اجرا کنید: npm start');
