'use strict';

/**
 * نرخ‌های مصوب هر سال (مبالغ به تومان).
 * برای افزودن سال جدید، یک ورودی با همان ساختار اضافه کنید.
 *
 * منابع: مصوبه‌ی شورای عالی کار و قانون بودجه‌ی همان سال.
 *   ۱۴۰۵: حداقل مزد روزانه ۵۵۴٫۱۸۵ تومان، حداقل حقوق ماهانه ۱۶٫۶۲۵٫۵۵۰ تومان،
 *          حق مسکن ۳٫۰۰۰٫۰۰۰، بن ۲٫۲۰۰٫۰۰۰، حق اولاد ۱٫۶۶۲٫۵۵۵ به‌ازای هر فرزند،
 *          معافیت مالیات ماهانه ۴۰٫۰۰۰٫۰۰۰ تومان و پله‌های ۱۰ تا ۳۰ درصد.
 */
const YEAR_PRESETS = {
  1405: {
    year: 1405,
    minimumMonthlyWage: 16625550,
    housingAllowance: 3000000,
    foodAllowance: 2200000,
    familyAllowancePerChild: 1662555,
    taxExemptionMonthly: 40000000,
    employerUnemploymentRate: 0.03,
    taxBrackets: [
      { upTo: 40000000, rate: 0 },
      { upTo: 80000000, rate: 0.1 },
      { upTo: 100000000, rate: 0.15 },
      { upTo: 120000000, rate: 0.2 },
      { upTo: 140000000, rate: 0.25 },
      { upTo: null, rate: 0.3 },
    ],
  },
  1404: {
    year: 1404,
    minimumMonthlyWage: 10492800,
    housingAllowance: 900000,
    foodAllowance: 2200000,
    familyAllowancePerChild: 1049280,
    taxExemptionMonthly: 24000000,
    employerUnemploymentRate: 0.02,
    taxBrackets: [
      { upTo: 24000000, rate: 0 },
      { upTo: 30000000, rate: 0.1 },
      { upTo: 38000000, rate: 0.15 },
      { upTo: 50000000, rate: 0.2 },
      { upTo: 66666667, rate: 0.25 },
      { upTo: null, rate: 0.3 },
    ],
  },
};

const PRESET_YEARS = Object.keys(YEAR_PRESETS).map(Number).sort((a, b) => b - a);
const LATEST_YEAR = PRESET_YEARS[0];

module.exports = { YEAR_PRESETS, PRESET_YEARS, LATEST_YEAR };
