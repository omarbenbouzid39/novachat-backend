const express = require('express');
const prisma = require('../../db/prisma');
const { requireAdminAuth, requireRole } = require('../../middleware/adminAuth');
const { logAdminAction } = require('../../services/auditLogger');
const { sendPushToTokens } = require('../../services/push');

const router = express.Router();
router.use(requireAdminAuth, requireRole('ADMIN'));

/**
 * POST /admin/notifications/broadcast
 * body: { title, body, audience: { type: 'ALL'|'COUNTRY'|'LANGUAGE'|'APP_VERSION', value?: string } }
 */
router.post('/broadcast', async (req, res, next) => {
  try {
    const { title, body, audience } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'العنوان والنص مطلوبان' });

    const audienceType = audience?.type || 'ALL';
    const audienceValue = audience?.value;

    let userWhere = {};
    if (audienceType === 'COUNTRY' && audienceValue) userWhere = { country: audienceValue };

    let pushTokenWhere = {};
    if (audienceType === 'LANGUAGE' && audienceValue) pushTokenWhere = { locale: audienceValue };
    if (audienceType === 'APP_VERSION' && audienceValue) pushTokenWhere = { appVersion: audienceValue };

    const users = audienceType === 'COUNTRY' ? await prisma.user.findMany({ where: userWhere, select: { id: true } }) : null;

    const tokens = await prisma.pushToken.findMany({
      where: {
        ...pushTokenWhere,
        ...(users ? { userId: { in: users.map((u) => u.id) } } : {}),
      },
      select: { token: true },
    });

    const tokenList = tokens.map((t) => t.token);
    let successCount = 0, failureCount = 0;

    if (tokenList.length > 0) {
      const result = await sendPushToTokens(tokenList, { title, body });
      successCount = result.successCount;
      failureCount = result.failureCount;
    }

    const record = await prisma.broadcastNotification.create({
      data: {
        sentById: req.adminId, title, body,
        audienceJson: JSON.stringify(audience || { type: 'ALL' }),
        recipientsCount: tokenList.length, successCount, failureCount,
      },
    });

    await logAdminAction({ adminId: req.adminId, action: 'NOTIFICATION_BROADCAST', targetType: 'NOTIFICATION', targetId: record.id, metadata: { title, audience, recipientsCount: tokenList.length } });

    res.status(201).json(record);
  } catch (err) { next(err); }
});

router.get('/broadcast/history', async (req, res, next) => {
  try {
    const history = await prisma.broadcastNotification.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    res.json(history);
  } catch (err) { next(err); }
});

module.exports = router;
