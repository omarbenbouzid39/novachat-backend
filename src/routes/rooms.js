const express = require('express');
const { v4: uuid } = require('uuid');
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

function serializeRoom(room, membersCount) {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    iconUrl: room.iconUrl,
    bannerUrl: room.bannerUrl,
    visibility: room.visibility,
    ownerId: room.ownerId,
    membersCount: membersCount ?? room._count?.members ?? 0,
    rules: room.rulesJson ? JSON.parse(room.rulesJson) : [],
    parentRoomId: room.parentRoomId,
    createdAtEpochMillis: room.createdAt.getTime(),
  };
}

router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const memberships = await prisma.roomMember.findMany({
      where: { userId: req.userId },
      include: { room: { include: { _count: { select: { members: true } } } } },
    });
    res.json(memberships.map((m) => serializeRoom(m.room)));
  } catch (err) { next(err); }
});

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rooms = await prisma.room.findMany({
      where: { visibility: 'PUBLIC' },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(rooms.map((r) => serializeRoom(r)));
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, description, visibility, parentRoomId } = req.body;
    if (!name) throw new ApiError(400, 'VALIDATION_ERROR', 'اسم المجتمع مطلوب');

    const room = await prisma.room.create({
      data: {
        id: uuid(),
        name,
        description: description || '',
        visibility: visibility === 'PRIVATE' ? 'PRIVATE' : 'PUBLIC',
        ownerId: req.userId,
        parentRoomId: parentRoomId || null,
        members: { create: [{ userId: req.userId, role: 'OWNER' }] },
      },
    });

    res.status(201).json(serializeRoom(room, 1));
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { members: true } } },
    });
    if (!room) throw new ApiError(404, 'NOT_FOUND', 'المجتمع غير موجود');
    res.json(serializeRoom(room));
  } catch (err) { next(err); }
});

router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: req.params.id, userId: req.userId } },
    });
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      throw new ApiError(403, 'FORBIDDEN', 'لا تملك صلاحية تعديل هذا المجتمع');
    }
    const { name, description, iconUrl, bannerUrl } = req.body;
    const room = await prisma.room.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(iconUrl !== undefined && { iconUrl }),
        ...(bannerUrl !== undefined && { bannerUrl }),
      },
    });
    res.json(serializeRoom(room));
  } catch (err) { next(err); }
});

router.post('/:id/join', requireAuth, async (req, res, next) => {
  try {
    await prisma.roomMember.upsert({
      where: { roomId_userId: { roomId: req.params.id, userId: req.userId } },
      create: { roomId: req.params.id, userId: req.userId, role: 'MEMBER' },
      update: {},
    });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/:id/leave', requireAuth, async (req, res, next) => {
  try {
    await prisma.roomMember.deleteMany({ where: { roomId: req.params.id, userId: req.userId } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get('/:id/members', requireAuth, async (req, res, next) => {
  try {
    const members = await prisma.roomMember.findMany({ where: { roomId: req.params.id } });
    res.json(members.map((m) => ({
      userId: m.userId, roomId: m.roomId, role: m.role, isMuted: m.isMuted,
      joinedAtEpochMillis: m.joinedAt.getTime(),
    })));
  } catch (err) { next(err); }
});

async function requireModerator(roomId, userId) {
  const membership = await prisma.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
  if (!membership || !['OWNER', 'ADMIN', 'MODERATOR'].includes(membership.role)) {
    throw new ApiError(403, 'FORBIDDEN', 'لا تملك صلاحيات الإشراف على هذا المجتمع');
  }
}

router.patch('/:id/members/:userId/role', requireAuth, async (req, res, next) => {
  try {
    await requireModerator(req.params.id, req.userId);
    await prisma.roomMember.update({
      where: { roomId_userId: { roomId: req.params.id, userId: req.params.userId } },
      data: { role: req.body.role },
    });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.delete('/:id/members/:userId', requireAuth, async (req, res, next) => {
  try {
    await requireModerator(req.params.id, req.userId);
    await prisma.roomMember.deleteMany({ where: { roomId: req.params.id, userId: req.params.userId } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.patch('/:id/members/:userId/mute', requireAuth, async (req, res, next) => {
  try {
    await requireModerator(req.params.id, req.userId);
    await prisma.roomMember.update({
      where: { roomId_userId: { roomId: req.params.id, userId: req.params.userId } },
      data: { isMuted: !!req.body.muted },
    });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get('/search/query', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '');
    const rooms = await prisma.room.findMany({
      where: { name: { contains: q, mode: 'insensitive' } },
      include: { _count: { select: { members: true } } },
      take: 20,
    });
    res.json(rooms.map((r) => serializeRoom(r)));
  } catch (err) { next(err); }
});

module.exports = router;
