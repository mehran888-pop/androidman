'use strict';

const path = require('path');
const express = require('express');
const { router } = require('./routes/api');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // CORS — برای استفاده‌ی اپ اندروید (Capacitor) و پنل‌های روی دامنه‌ی دیگر
  app.use((req, res, next) => {
    const origin = req.get('origin');
    const allowed = String(process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim());
    if (origin) {
      res.setHeader('Vary', 'Origin');
      if (allowed.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
      else if (allowed.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-panel-password');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  });

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  app.use('/api', router);

  const webDir = path.join(__dirname, '..', 'web');
  // بدون کش طولانی: پنل بعد از هر به‌روزرسانی تازه بارگذاری می‌شود (ETag برای اعتبارسنجی)
  app.use(express.static(webDir, { extensions: ['html'], maxAge: 0, etag: true }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(webDir, 'index.html'));
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'مسیر پیدا نشد.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'بدنه‌ی JSON نامعتبر است.' });
    }
    console.error('[server]', err.stack || err);
    if (res.headersSent) return;
    return res.status(err.status || 500).json({ error: err.message || 'خطای داخلی سرور' });
  });

  return app;
}

module.exports = { createApp };
