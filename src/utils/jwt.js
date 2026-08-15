const jwt = require('jsonwebtoken');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  // فشل مبكر وواضح بدل تشغيل خادم بمفاتيح فارغة (ثغرة أمنية خطيرة)
  throw new Error(
    'JWT_ACCESS_SECRET / JWT_REFRESH_SECRET غير معرّفين. أضفهما في ملف .env قبل تشغيل الخادم.'
  );
}

function signAccessToken(userId) {
  return jwt.sign({ sub: userId, type: 'access' }, ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  });
}

function signRefreshToken(userId) {
  return jwt.sign({ sub: userId, type: 'refresh' }, REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

module.exports = { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken };
