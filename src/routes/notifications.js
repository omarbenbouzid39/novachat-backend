const express = require('express');
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function serialize(n) {
  return {
    id: n.id, type: n.type, actorUserId: n.actorUserId, targetId: n.relatedId,
    message: n.message, isRead: n.isRead, createdAtEpochMillis: n.createdAt.getTime(),
  };
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { targetId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(notifications.map(serialize));
  } catch (err) { next(err); }
});

router.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({ where: { id: req.params.id, targetId: req.userId }, data: { isRead: true } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/read-all', requireAuth, async (req, res, next) => {
  try {
    await prisma.notification.updateMany({ where: { targetId: req.userId }, data: { isRead: true } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
