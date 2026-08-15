const jwt = require('jsonwebtoken');

const ADMIN_ACCESS_SECRET = process.env.ADMIN_JWT_ACCESS_SECRET;
const ADMIN_REFRESH_SECRET = process.env.ADMIN_JWT_REFRESH_SECRET;

if (!ADMIN_ACCESS_SECRET || !ADMIN_REFRESH_SECRET) {
  throw new Error(
    'ADMIN_JWT_ACCESS_SECRET / ADMIN_JWT_REFRESH_SECRET غير معرّفين. أضفهما في .env قبل تشغيل الخادم.'
  );
}

/**
 * توكنات الإدارة معزولة تمامًا عن توكنات المستخدمين العاديين (سرّ توقيع
 * مختلف تمامًا)، بحيث لا يمكن لأي توكن مستخدم عادي — مهما كان — أن يُستخدم
 * للوصول إلى أي مسار إداري، والعكس صحيح.
 */
function signAdminAccessToken(adminId, role) {
  return jwt.sign({ sub: adminId, role, type: 'admin_access' }, ADMIN_ACCESS_SECRET, {
    expiresIn: process.env.ADMIN_JWT_ACCESS_EXPIRES_IN || '15m',
  });
}

function signAdminRefreshToken(adminId) {
  return jwt.sign({ sub: adminId, type: 'admin_refresh' }, ADMIN_REFRESH_SECRET, {
    expiresIn: process.env.ADMIN_JWT_REFRESH_EXPIRES_IN || '7d',
  });
}

/** توكن مؤقت جدًا (5 دقائق) بين خطوة كلمة المرور وخطوة رمز 2FA فقط. */
function signAdmin2FAPendingToken(adminId) {
  return jwt.sign({ sub: adminId, type: 'admin_2fa_pending' }, ADMIN_ACCESS_SECRET, { expiresIn: '5m' });
}

function verifyAdminAccessToken(token) {
  const payload = jwt.verify(token, ADMIN_ACCESS_SECRET);
  if (payload.type !== 'admin_access') throw new Error('نوع توكن غير صحيح');
  return payload;
}

function verifyAdminRefreshToken(token) {
  const payload = jwt.verify(token, ADMIN_REFRESH_SECRET);
  if (payload.type !== 'admin_refresh') throw new Error('نوع توكن غير صحيح');
  return payload;
}

function verifyAdmin2FAPendingToken(token) {
  const payload = jwt.verify(token, ADMIN_ACCESS_SECRET);
  if (payload.type !== 'admin_2fa_pending') throw new Error('نوع توكن غير صحيح');
  return payload;
}

module.exports = {
  signAdminAccessToken,
  signAdminRefreshToken,
  signAdmin2FAPendingToken,
  verifyAdminAccessToken,
  verifyAdminRefreshToken,
  verifyAdmin2FAPendingToken,
};
