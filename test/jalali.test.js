'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  todayJalali,
  toGregorian,
  fromGregorian,
  jalaaliMonthLength,
  isLeapJalaaliYear,
  periodKey,
  parsePeriod,
  periodLabel,
  shiftPeriod,
  recentPeriods,
  formatJalali,
  toPersianDigits,
} = require('../src/payroll/jalali');

test('تبدیل شمسی/میلادی رفت‌وبرگشت', () => {
  for (const [jy, jm, jd] of [[1404, 1, 1], [1404, 7, 15], [1403, 12, 29], [1399, 12, 30], [1405, 6, 31]]) {
    const g = toGregorian(jy, jm, jd);
    const back = fromGregorian(g);
    assert.deepEqual(back, { jy, jm, jd });
  }
});

test('نوروز ۱۴۰۴ برابر ۲۰ مارس ۲۰۲۵ است', () => {
  const g = toGregorian(1404, 1, 1);
  assert.equal(g.toISOString().slice(0, 10), '2025-03-21');
});

test('طول ماه‌ها درست است', () => {
  for (let m = 1; m <= 6; m += 1) assert.equal(jalaaliMonthLength(1404, m), 31);
  for (let m = 7; m <= 11; m += 1) assert.equal(jalaaliMonthLength(1404, m), 30);
  assert.equal(jalaaliMonthLength(1404, 12), isLeapJalaaliYear(1404) ? 30 : 29);
});

test('سال کبیسه‌ها', () => {
  assert.equal(isLeapJalaaliYear(1403), true);
  assert.equal(isLeapJalaaliYear(1404), false);
});

test('امروز با Intl مطابقت دارد', () => {
  const { jy, jm, jd } = todayJalali(new Date('2026-03-21T10:00:00Z'));
  assert.deepEqual({ jy, jm, jd }, { jy: 1405, jm: 1, jd: 1 });
});

test('کلید دوره و تجزیه‌ی آن', () => {
  assert.equal(periodKey(1404, 7), '1404-07');
  assert.deepEqual(parsePeriod('1404-7'), { jy: 1404, jm: 7 });
  assert.equal(parsePeriod('1404-13'), null);
  assert.equal(parsePeriod('چیز دیگری'), null);
});

test('برچسب دوره فارسی است', () => {
  assert.equal(periodLabel(1404, 7), 'مهر 1404');
});

test('جابه‌جایی دوره بین سال‌ها', () => {
  assert.deepEqual(shiftPeriod(1404, 1, -1), { jy: 1403, jm: 12 });
  assert.deepEqual(shiftPeriod(1403, 12, 1), { jy: 1404, jm: 1 });
  assert.deepEqual(shiftPeriod(1404, 6, 8), { jy: 1405, jm: 2 });
});

test('فهرست دوره‌های اخیر نزولی و پیوسته است', () => {
  const list = recentPeriods(3, new Date('2025-10-01T00:00:00Z'));
  assert.equal(list.length, 3);
  assert.equal(list[0].key, periodKey(1404, 7));
  assert.equal(list[2].key, periodKey(1404, 5));
});

test('قالب‌بندی تاریخ و ارقام فارسی', () => {
  assert.equal(formatJalali(1404, 7, 3), '1404/07/03');
  assert.equal(toPersianDigits('1404/07'), '۱۴۰۴/۰۷');
});
