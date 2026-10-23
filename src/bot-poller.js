'use strict';

/**
 * دریافت پیام‌های ربات بله با روش long-polling (بدون نیاز به دامنه و HTTPS).
 * اجرا: npm run bot
 */

const store = require('./store');
const { BaleClient, BaleError } = require('./bale/client');
const { handleUpdate } = require('./bale/commands');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  store.load();
  const settings = store.getSettings({ mask: false });
  const token = settings.baleToken || process.env.BALE_BOT_TOKEN;
  if (!token) {
    console.error('❌ توکن ربات بله تنظیم نشده است. آن را در تنظیمات برنامه وارد کنید یا BALE_BOT_TOKEN را ست کنید.');
    process.exit(1);
  }

  const client = new BaleClient({ token });
  let me;
  try {
    me = await client.getMe();
    console.log(`🤖 ربات متصل شد: @${me.username || me.first_name}`);
  } catch (err) {
    console.error('❌ اتصال به بله ناموفق بود:', err.message);
    process.exit(1);
  }

  // در حالت polling، وب‌هوک باید حذف شود
  try {
    await client.deleteWebhook();
  } catch { /* ignore */ }

  console.log('👂 در حال شنیدن پیام‌ها... (Ctrl+C برای خروج)');

  let offset;
  let running = true;
  process.on('SIGINT', () => { running = false; console.log('\nخروج...'); });

  while (running) {
    try {
      const updates = await client.getUpdates({ offset, timeout: 30, limit: 50 });
      for (const update of updates || []) {
        offset = (update.update_id || 0) + 1;
        try {
          const reply = await handleUpdate(update);
          if (reply?.chatId) {
            await client.sendMessage(reply.chatId, reply.text);
            console.log(`↩️ پاسخ به ${reply.chatId}`);
          }
        } catch (err) {
          console.error('[update]', err.message);
        }
      }
    } catch (err) {
      if (err instanceof BaleError) {
        console.error('⚠️', err.message);
        await sleep(err.status === 401 ? 30000 : 3000);
      } else {
        console.error('⚠️', err.message);
        await sleep(3000);
      }
    }
  }
  store.flush();
  process.exit(0);
}

main();
