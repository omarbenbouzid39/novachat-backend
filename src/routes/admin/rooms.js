const express = require('express');
const prisma = require('../../db/prisma');
const { requireAdminAuth, requireRole } = require('../../middleware/adminAuth');
const { ApiError } = require('../../middleware/errorHandler');
const { logAdminAction } = require('../../services/auditLogger');

const router = express.Router();
router.use(requireAdminAuth, requireRole('MODERATOR'));

/** GET /admin/rooms?query=&page=&pageSize= */
router.get('/', async (req, res, next) => {
  try {
    const query = String(req.query.query || '').trim();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Number(req.query.pageSize) || 25, 100);

    const where = query ? { name: { contains: query, mode: 'insensitive' } } : {};

    const [rooms, total] = await Promise.all([
      prisma.room.findMany({
        where, include: { _count: { select: { members: true } } },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
      }),
      prisma.room.count({ where }),
    ]);

    res.json({
      items: rooms.map((r) => ({ ...r, membersCount: r._count.members })),
      total, page, pageSize, totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) { next(err); }
});

router.patch('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { name, description, visibility } = req.body;
    const room = await prisma.room.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(visibility !== undefined && { visibility }),
      },
    });
    await logAdminAction({ adminId: req.adminId, action: 'ROOM_UPDATED', targetType: 'ROOM', targetId: room.id, metadata: req.body });
    res.json(room);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await logAdminAction({ adminId: req.adminId, action: 'ROOM_DELETED', targetType: 'ROOM', targetId: req.params.id });
    await prisma.room.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get('/:id/members', async (req, res, next) => {
  try {
    const members = await prisma.roomMember.findMany({
      where: { roomId: req.params.id },
      include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
    });
    res.json(members);
  } catch (err) { next(err); }
});

router.patch('/:id/members/:userId/role', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { role } = req.body;
    await prisma.roomMember.update({
      where: { roomId_userId: { roomId: req.params.id, userId: req.params.userId } },
      data: { role },
    });
    await logAdminAction({ adminId: req.adminId, action: 'ROOM_MEMBER_ROLE_CHANGED', targetType: 'ROOM', targetId: req.params.id, metadata: { userId: req.params.userId, role } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.delete('/:id/members/:userId', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await prisma.roomMember.deleteMany({ where: { roomId: req.params.id, userId: req.params.userId } });
    await logAdminAction({ adminId: req.adminId, action: 'ROOM_MEMBER_REMOVED', targetType: 'ROOM', targetId: req.params.id, metadata: { userId: req.params.userId } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
