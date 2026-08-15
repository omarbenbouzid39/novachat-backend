const express = require('express');
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ users: [], rooms: [], posts: [], messages: [], hashtags: [] });

    const [users, rooms, posts] = await Promise.all([
      prisma.user.findMany({
        where: { OR: [{ username: { contains: q, mode: 'insensitive' } }, { displayName: { contains: q, mode: 'insensitive' } }] },
        take: 10,
      }),
      prisma.room.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, take: 10 }),
      prisma.post.findMany({ where: { text: { contains: q, mode: 'insensitive' } }, take: 10 }),
    ]);

    res.json({
      users: users.map(({ passwordHash, ...u }) => u),
      rooms: rooms.map((r) => ({ ...r, rules: r.rulesJson ? JSON.parse(r.rulesJson) : [] })),
      posts: posts.map((p) => ({ ...p, mediaItems: p.mediaJson ? JSON.parse(p.mediaJson) : [] })),
      messages: [],
      hashtags: [],
    });
  } catch (err) { next(err); }
});

module.exports = router;
