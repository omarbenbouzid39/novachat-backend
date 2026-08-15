const rateLimit = require('express-rate-limit');

const generalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60000),
  limit: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'طلبات كثيرة جدًا، حاول لاحقًا' },
});

// حد أشد صرامة على مسارات المصادقة لمنع هجمات Brute-force على كلمات المرور
const authLimiter = rateLimit({
  windowMs: 60000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'محاولات كثيرة جدًا، حاول بعد قليل' },
});

module.exports = { generalLimiter, authLimiter };
