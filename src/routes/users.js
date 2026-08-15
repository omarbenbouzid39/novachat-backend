const express = require('express');
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

function toPublicUser(user, extra = {}) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return { ...rest, ...extra };
}

async function withCounts(user) {
  const [followersCount, followingCount, postsCount] = await Promise.all([
    prisma.follow.count({ where: { followingId: user.id } }),
    prisma.follow.count({ where: { followerId: user.id } }),
    prisma.post.count({ where: { authorId: user.id } }),
  ]);
  return toPublicUser(user, { followersCount, followingCount, postsCount });
}

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'المستخدم غير موجود');
    res.json(await withCounts(user));
  } catch (err) { next(err); }
});

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { displayName, bio, country, statusMessage, avatarUrl, coverUrl } = req.body;
    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(bio !== undefined && { bio }),
        ...(country !== undefined && { country }),
        ...(statusMessage !== undefined && { statusMessage }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(coverUrl !== undefined && { coverUrl }),
      },
    });
    res.json(await withCounts(user));
  } catch (err) { next(err); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'المستخدم غير موجود');
    res.json(await withCounts(user));
  } catch (err) { next(err); }
});

router.post('/:id/follow', requireAuth, async (req, res, next) => {
  try {
    if (req.params.id === req.userId) throw new ApiError(400, 'INVALID_OPERATION', 'لا يمكنك متابعة نفسك');
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId: req.userId, followingId: req.params.id } },
      create: { followerId: req.userId, followingId: req.params.id },
      update: {},
    });
    await prisma.notification.create({
      data: {
        targetId: req.params.id,
        type: 'FOLLOW',
        actorUserId: req.userId,
        message: 'بدأ شخص بمتابعتك',
      },
    });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.delete('/:id/follow', requireAuth, async (req, res, next) => {
  try {
    await prisma.follow.deleteMany({ where: { followerId: req.userId, followingId: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get('/:id/followers', requireAuth, async (req, res, next) => {
  try {
    const follows = await prisma.follow.findMany({ where: { followingId: req.params.id }, include: { follower: true } });
    res.json(await Promise.all(follows.map((f) => withCounts(f.follower))));
  } catch (err) { next(err); }
});

router.get('/:id/following', requireAuth, async (req, res, next) => {
  try {
    const follows = await prisma.follow.findMany({ where: { followerId: req.params.id }, include: { following: true } });
    res.json(await Promise.all(follows.map((f) => withCounts(f.following))));
  } catch (err) { next(err); }
});

module.exports = router;
