const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../../db/prisma');
const { requireAdminAuth, requireRole } = require('../../middleware/adminAuth');
const { ApiError } = require('../../middleware/errorHandler');
const { logAdminAction } = require('../../services/auditLogger');

const router = express.Router();
router.use(requireAdminAuth, requireRole('SUPER_ADMIN'));

function toSafeAdmin(admin) {
  const { passwordHash, twoFactorSecret, ...safe } = admin;
  return safe;
}

/** GET /admin/admins — قائمة حسابات لوحة التحكم (SUPER_ADMIN فقط) */
router.get('/', async (req, res, next) => {
  try {
    const admins = await prisma.adminUser.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(admins.map(toSafeAdmin));
  } catch (err) { next(err); }
});

/** POST /admin/admins — إنشاء حساب مشرف جديد */
router.post('/', async (req, res, next) => {
  try {
    const { email, password, displayName, role } = req.body;
    if (!email || !password || !displayName) throw new ApiError(400, 'VALIDATION_ERROR', 'البيانات ناقصة');
    if (password.length < 10) throw new ApiError(400, 'VALIDATION_ERROR', 'كلمة مرور المشرف يجب أن تكون 10 أحرف على الأقل');

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.adminUser.create({
      data: { email, passwordHash, displayName, role: role || 'SUPPORT' },
    });

    await logAdminAction({ adminId: req.adminId, action: 'ADMIN_CREATED', targetType: 'USER', targetId: admin.id, metadata: { email, role } });
    res.status(201).json(toSafeAdmin(admin));
  } catch (err) { next(err); }
});

/** PATCH /admin/admins/:id — تعديل دور/حالة مشرف */
router.patch('/:id', async (req, res, next) => {
  try {
    const { role, isActive, displayName } = req.body;
    if (req.params.id === req.adminId && isActive === false) {
      throw new ApiError(400, 'INVALID_OPERATION', 'لا يمكنك تعطيل حسابك الخاص');
    }

    const admin = await prisma.adminUser.update({
      where: { id: req.params.id },
      data: {
        ...(role !== undefined && { role }),
        ...(isActive !== undefined && { isActive }),
        ...(displayName !== undefined && { displayName }),
      },
    });
    await logAdminAction({ adminId: req.adminId, action: 'ADMIN_UPDATED', targetType: 'USER', targetId: admin.id, metadata: req.body });
    res.json(toSafeAdmin(admin));
  } catch (err) { next(err); }
});

/** DELETE /admin/admins/:id */
router.delete('/:id', async (req, res, next) => {
  try {
    if (req.params.id === req.adminId) throw new ApiError(400, 'INVALID_OPERATION', 'لا يمكنك حذف حسابك الخاص');
    await logAdminAction({ adminId: req.adminId, action: 'ADMIN_DELETED', targetType: 'USER', targetId: req.params.id });
    await prisma.adminUser.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
