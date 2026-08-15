const express = require('express');
const prisma = require('../../db/prisma');
const { requireAdminAuth, requireRole } = require('../../middleware/adminAuth');
const { ApiError } = require('../../middleware/errorHandler');
const { logAdminAction } = require('../../services/auditLogger');

const router = express.Router();
router.use(requireAdminAuth);

/** GET /admin/verification?status=PENDING */
router.get('/', requireRole('MODERATOR'), async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const requests = await prisma.verificationRequest.findMany({
      where: status ? { status } : {},
      include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true, isVerified: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(requests);
  } catch (err) { next(err); }
});

/** POST /admin/verification/:id/approve */
router.post('/:id/approve', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const request = await prisma.verificationRequest.findUnique({ where: { id: req.params.id } });
    if (!request) throw new ApiError(404, 'NOT_FOUND', 'الطلب غير موجود');

    await prisma.$transaction([
      prisma.verificationRequest.update({
        where: { id: req.params.id },
        data: { status: 'APPROVED', reviewedById: req.adminId, reviewedAt: new Date() },
      }),
      prisma.user.update({ where: { id: request.userId }, data: { isVerified: true } }),
    ]);

    await prisma.notification.create({
      data: { targetId: request.userId, type: 'SYSTEM', actorUserId: request.userId, message: 'تم توثيق حسابك بنجاح ✅' },
    });

    await logAdminAction({ adminId: req.adminId, action: 'VERIFICATION_APPROVED', targetType: 'VERIFICATION', targetId: request.id });
    res.status(204).send();
  } catch (err) { next(err); }
});

/** POST /admin/verification/:id/reject { reason } */
router.post('/:id/reject', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason) throw new ApiError(400, 'VALIDATION_ERROR', 'سبب الرفض مطلوب');

    const request = await prisma.verificationRequest.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', rejectionReason: reason, reviewedById: req.adminId, reviewedAt: new Date() },
    });

    await logAdminAction({ adminId: req.adminId, action: 'VERIFICATION_REJECTED', targetType: 'VERIFICATION', targetId: request.id, metadata: { reason } });
    res.status(204).send();
  } catch (err) { next(err); }
});

/** إزالة علامة التوثيق مباشرة من مستخدم (بلا طلب) */
router.post('/users/:userId/revoke-badge', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.params.userId }, data: { isVerified: false } });
    await logAdminAction({ adminId: req.adminId, action: 'VERIFICATION_BADGE_REVOKED', targetType: 'USER', targetId: req.params.userId });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
