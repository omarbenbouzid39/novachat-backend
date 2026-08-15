const express = require('express');
const prisma = require('../../db/prisma');
const { requireAdminAuth, requireRole } = require('../../middleware/adminAuth');
const { ApiError } = require('../../middleware/errorHandler');
const { logAdminAction } = require('../../services/auditLogger');

const router = express.Router();
router.use(requireAdminAuth, requireRole('MODERATOR'));

/** GET /admin/moderation/reports?status=PENDING&targetType=POST */
router.get('/reports', async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : undefined;
    const targetType = req.query.targetType ? String(req.query.targetType) : undefined;

    const reports = await prisma.report.findMany({
      where: { ...(status && { status }), ...(targetType && { targetType }) },
      include: { reporter: { select: { id: true, username: true, displayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(reports);
  } catch (err) { next(err); }
});

/** POST /admin/moderation/reports/:id/resolve { action: DISMISS|ACTION_TAKEN, note } */
router.post('/reports/:id/resolve', async (req, res, next) => {
  try {
    const { action, note } = req.body;
    const status = action === 'DISMISS' ? 'DISMISSED' : 'ACTION_TAKEN';

    const report = await prisma.report.update({
      where: { id: req.params.id },
      data: { status, resolvedById: req.adminId, resolvedAt: new Date(), resolutionNote: note || null },
    });

    await logAdminAction({ adminId: req.adminId, action: `REPORT_${status}`, targetType: 'REPORT', targetId: report.id, metadata: { note } });
    res.json(report);
  } catch (err) { next(err); }
});

/** DELETE /admin/moderation/content/:type/:id — حذف محتوى مُبلَّغ عنه (POST|COMMENT|MESSAGE|ROOM) */
router.delete('/content/:type/:id', async (req, res, next) => {
  try {
    const { type, id } = req.params;
    switch (type.toUpperCase()) {
      case 'POST': await prisma.post.delete({ where: { id } }); break;
      case 'COMMENT': await prisma.comment.delete({ where: { id } }); break;
      case 'MESSAGE': await prisma.message.update({ where: { id }, data: { isDeletedForEveryone: true, text: null, mediaJson: null } }); break;
      case 'ROOM': await prisma.room.delete({ where: { id } }); break;
      default: throw new ApiError(400, 'VALIDATION_ERROR', 'نوع محتوى غير مدعوم');
    }
    await logAdminAction({ adminId: req.adminId, action: 'CONTENT_DELETED', targetType: type.toUpperCase(), targetId: id });
    res.status(204).send();
  } catch (err) { next(err); }
});

/** POST /admin/moderation/users/:id/mute-global { durationHours } — كتم مؤقت من كل الغرف */
router.post('/users/:id/mute-global', async (req, res, next) => {
  try {
    await prisma.roomMember.updateMany({ where: { userId: req.params.id }, data: { isMuted: true } });
    await logAdminAction({ adminId: req.adminId, action: 'USER_MUTED_GLOBAL', targetType: 'USER', targetId: req.params.id, metadata: req.body });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
