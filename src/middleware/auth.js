const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../db/prisma');

function startOfDayUtc(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** يسجّل حدث نشاط يومي واحد فقط لكل مستخدم (لحساب DAU/WAU/MAU في لوحة
 * التحكم بدقة معقولة) دون إبطاء الطلب — "Fire and forget" مع تجاهل خطأ
 * انتهاك القيد الفريد (يعني أنه سُجِّل بالفعل اليوم). */
function trackActivity(userId) {
  prisma.activityEvent
    .create({ data: { userId, day: startOfDayUtc(new Date()) } })
    .catch(() => { /* موجود بالفعل لهذا اليوم، أو خطأ عابر — لا يوقف الطلب الأساسي */ });
}

/**
 * يتحقق من Access Token في هيدر Authorization: Bearer <token>.
 * عند الفشل يعيد 401 حتى يعرف عميل Android أنه يحتاج تحديث التوكن
 * (Refresh) عبر /auth/refresh، بدل الاستمرار بطلب فاشل بصمت. كما يتحقق
 * من أن الحساب غير محظور/معطّل من قبل لوحة التحكم الإدارية.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'رمز الدخول مفقود' });
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.type !== 'access') throw new Error('نوع توكن غير صحيح');

    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isBanned: true, isDisabled: true, bannedReason: true } });
    if (!user) return res.status(401).json({ error: 'USER_NOT_FOUND', message: 'الحساب غير موجود' });
    if (user.isBanned) return res.status(403).json({ error: 'ACCOUNT_BANNED', message: user.bannedReason || 'تم حظر هذا الحساب' });
    if (user.isDisabled) return res.status(403).json({ error: 'ACCOUNT_DISABLED', message: 'هذا الحساب مُعطَّل حاليًا' });

    req.userId = payload.sub;
    trackActivity(payload.sub);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'TOKEN_EXPIRED_OR_INVALID', message: 'رمز الدخول منتهي أو غير صالح' });
  }
}

module.exports = { requireAuth };
