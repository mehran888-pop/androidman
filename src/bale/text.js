'use strict';

/**
 * تقسیم متن بلند به چند پیام، بدون شکستن تگ‌های HTML
 * (بله/تلگرام سقف ۴۰۹۶ کاراکتر دارند؛ ما محافظه‌کارانه ۳۵۰۰ می‌گیریم).
 */

const LIMIT = 3500;

function splitMessage(text, limit = LIMIT) {
  const source = String(text ?? '');
  if (source.length <= limit) return [source];

  const chunks = [];
  let current = '';
  const lines = source.split('\n');

  const push = () => {
    if (current.trim()) chunks.push(current.replace(/\n+$/, ''));
    current = '';
  };

  for (const line of lines) {
    if (line.length > limit) {
      // خط خیلی بلند: تقسیم سخت روی فاصله
      const words = line.split(' ');
      for (const word of words) {
        if ((current + word).length > limit) push();
        current += (current ? ' ' : '') + word;
      }
      current += '\n';
      continue;
    }
    if ((current + line).length > limit) push();
    current += line + '\n';
  }
  push();
  return chunks.length ? chunks : [''];
}

module.exports = { splitMessage, LIMIT };
