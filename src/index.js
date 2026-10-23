'use strict';

const { createApp } = require('./app');
const store = require('./store');
const { todayJalali, periodLabel } = require('./payroll/jalali');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

store.load();
const app = createApp();

const server = app.listen(PORT, HOST, () => {
  const { jy, jm } = todayJalali();
  console.log(`\n🧮 حقوق‌یار روی http://${HOST}:${PORT} بالا آمد`);
  console.log(`📅 امروز: ${periodLabel(jy, jm)}`);
  console.log(`💾 فایل داده: ${store.DATA_FILE}`);
  if (process.env.PANEL_PASSWORD) console.log('🔒 ورود پنل با رمز (PANEL_PASSWORD) فعال است.');
  console.log('🤖 برای فعال‌سازی ربات بله: بخش «ربات بله» در تنظیمات برنامه.\n');
  console.log('برای دریافت پیام‌های ربات بدون دامنه، دستور `npm run bot` را در ترمینال دیگری اجرا کنید.\n');
});

function shutdown(signal) {
  console.log(`\n${signal} دریافت شد، ذخیره‌سازی و خروج...`);
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { server };
