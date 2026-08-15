const { verifyAdminAccessToken } = require('../utils/adminJwt');
const prisma = require('../db/prisma');

const ROLE_HIERARCHY = ['SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];

/**
 * يتحقق من توكن إدارة صالح (مُوقَّع بسرّ إداري منفصل تمامًا عن توكنات
 * المستخدمين). أي طلب بلا توكن إداري صحيح يُرفض فورًا — لا يوجد أي مسار
 * تحت /admin يُستثنى من هذا الفحص باستثناء تسجيل الدخول نفسه.
 */
async function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'رمز دخول الإدارة مفقود' });
  }

  try {
    const payload = verifyAdminAccessToken(token);
    const admin = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive) {
      return res.status(401).json({ error: 'ADMIN_INACTIVE', message: 'الحساب الإداري غير نشط' });
    }
    req.adminId = admin.id;
    req.adminRole = admin.role;
    req.admin = admin;
    next();
  } catch {
    return res.status(401).json({ error: 'TOKEN_EXPIRED_OR_INVALID', message: 'رمز الدخول منتهٍ أو غير صالح' });
  }
}

/** يسمح فقط للأدوار المذكورة (أو أي دور أعلى منها في التسلسل الهرمي). */
function requireRole(...allowedRoles) {
  const minLevel = Math.min(...allowedRoles.map((r) => ROLE_HIERARCHY.indexOf(r)));
  return (req, res, next) => {
    const level = ROLE_HIERARCHY.indexOf(req.adminRole);
    if (level < minLevel) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'لا تملك صلاحية كافية لهذا الإجراء' });
    }
    next();
  };
}

module.exports = { requireAdminAuth, requireRole, ROLE_HIERARCHY };
