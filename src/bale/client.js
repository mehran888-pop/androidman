'use strict';

/**
 * کلاینت سبک برای API بازوی بله (سازگار با Telegram Bot API).
 * مستندات: https://docs.bale.ai
 * آدرس پایه: https://tapi.bale.ai/bot<TOKEN>/<METHOD>
 */

const DEFAULT_BASE = process.env.BALE_API_BASE || 'https://tapi.bale.ai';

class BaleError extends Error {
  constructor(message, { status, method, description } = {}) {
    super(message);
    this.name = 'BaleError';
    this.status = status;
    this.method = method;
    this.description = description;
  }
}

const TOKEN_RE = /^\d{6,}:[A-Za-z0-9_-]{20,}$/;

function isValidToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token.trim());
}

class BaleClient {
  constructor({ token, baseUrl = DEFAULT_BASE, timeoutMs = 20000 } = {}) {
    if (!token) throw new BaleError('توکن ربات بله تنظیم نشده است.');
    this.token = String(token).trim();
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  url(method) {
    return `${this.baseUrl}/bot${this.token}/${method}`;
  }

  async call(method, payload = {}, { timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || this.timeoutMs);
    try {
      const res = await fetch(this.url(method), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await res.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new BaleError(`پاسخ نامعتبر از بله (${res.status})`, {
          status: res.status,
          method,
          description: text.slice(0, 200),
        });
      }
      if (!res.ok || data.ok === false) {
        throw new BaleError(
          data.description || `خطای بله (${res.status})`,
          { status: res.status, method, description: data.description },
        );
      }
      return data.result;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new BaleError('اتصال به بله زمان‌بندی شد (timeout).', { method });
      }
      if (err instanceof BaleError) throw err;
      throw new BaleError(`ارتباط با بله برقرار نشد: ${err.message}`, { method });
    } finally {
      clearTimeout(timer);
    }
  }

  getMe() {
    return this.call('getMe');
  }

  getUpdates({ offset, limit = 50, timeout = 0 } = {}) {
    const payload = { limit, timeout };
    if (offset !== undefined) payload.offset = offset;
    return this.call('getUpdates', payload, { timeoutMs: (timeout + 15) * 1000 });
  }

  sendMessage(chatId, text, options = {}) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: options.parseMode === false ? undefined : (options.parseMode || 'HTML'),
      disable_web_page_preview: options.disablePreview !== false,
      reply_markup: options.replyMarkup,
      reply_to_message_id: options.replyTo,
    });
  }

  setWebhook(url, { secretToken } = {}) {
    const payload = { url };
    if (secretToken) payload.secret_token = secretToken;
    return this.call('setWebhook', payload);
  }

  deleteWebhook() {
    return this.call('deleteWebhook');
  }
}

module.exports = { BaleClient, BaleError, isValidToken, DEFAULT_BASE };
