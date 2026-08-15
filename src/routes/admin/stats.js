const express = require('express');
const prisma = require('../../db/prisma');
const { requireAdminAuth, requireRole } = require('../../middleware/adminAuth');

const router = express.Router();
router.use(requireAdminAuth, requireRole('SUPPORT'));

function startOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n) {
  return startOfDay(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}

/** GET /admin/stats/overview — أرقام لحظية عامة لبطاقات لوحة التحكم الرئيسية */
router.get('/overview', async (req, res, next) => {
  try {
    const [
      totalUsers, totalPosts, totalMessages, totalRooms, totalMedia,
      newToday, newThisWeek, newThisMonth,
      dau, wau, mau,
      pendingReports, pendingVerifications,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
      prisma.message.count(),
      prisma.room.count(),
      prisma.mediaAsset.count(),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(1) } } }),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(7) } } }),
      prisma.user.count({ where: { createdAt: { gte: daysAgo(30) } } }),
      prisma.activityEvent.groupBy({ by: ['userId'], where: { day: { gte: daysAgo(1) } } }).then((r) => r.length),
      prisma.activityEvent.groupBy({ by: ['userId'], where: { day: { gte: daysAgo(7) } } }).then((r) => r.length),
      prisma.activityEvent.groupBy({ by: ['userId'], where: { day: { gte: daysAgo(30) } } }).then((r) => r.length),
      prisma.report.count({ where: { status: 'PENDING' } }),
      prisma.verificationRequest.count({ where: { status: 'PENDING' } }),
    ]);

    const mediaStorage = await prisma.mediaAsset.aggregate({ _sum: { bytes: true } });

    res.json({
      totalUsers, totalPosts, totalMessages, totalRooms, totalMedia,
      newUsers: { today: newToday, thisWeek: newThisWeek, thisMonth: newThisMonth },
      activeUsers: { dau, wau, mau },
      pendingReports, pendingVerifications,
      storageBytesUsed: mediaStorage._sum.bytes || 0,
    });
  } catch (err) { next(err); }
});

/** GET /admin/stats/growth?days=30 — بيانات رسم بياني للنمو اليومي */
router.get('/growth', async (req, res, next) => {
  try {
    const days = Math.min(Number(req.query.days) || 30, 90);
    const since = daysAgo(days);

    const users = await prisma.user.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } });
    const posts = await prisma.post.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } });
    const messages = await prisma.message.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } });

    const bucket = (rows) => {
      const map = {};
      rows.forEach((r) => {
        const key = startOfDay(r.createdAt).toISOString().slice(0, 10);
        map[key] = (map[key] || 0) + 1;
      });
      return map;
    };

    const usersByDay = bucket(users);
    const postsByDay = bucket(posts);
    const messagesByDay = bucket(messages);

    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const key = daysAgo(i).toISOString().slice(0, 10);
      series.push({ date: key, newUsers: usersByDay[key] || 0, newPosts: postsByDay[key] || 0, newMessages: messagesByDay[key] || 0 });
    }

    res.json(series);
  } catch (err) { next(err); }
});

/** GET /admin/stats/top-content — أكثر المنشورات والغرف نشاطًا */
router.get('/top-content', async (req, res, next) => {
  try {
    const [topPosts, topRooms] = await Promise.all([
      prisma.post.findMany({
        orderBy: [{ likesCount: 'desc' }, { commentsCount: 'desc' }],
        take: 10,
        select: { id: true, text: true, authorId: true, likesCount: true, commentsCount: true, repostsCount: true, createdAt: true },
      }),
      prisma.room.findMany({
        include: { _count: { select: { members: true } } },
        orderBy: { members: { _count: 'desc' } },
        take: 10,
      }),
    ]);
    res.json({
      topPosts,
      topRooms: topRooms.map((r) => ({ id: r.id, name: r.name, membersCount: r._count.members })),
    });
  } catch (err) { next(err); }
});

/** GET /admin/stats/media — استهلاك Cloudinary/التخزين حسب النوع */
router.get('/media', async (req, res, next) => {
  try {
    const byType = await prisma.mediaAsset.groupBy({
      by: ['type'],
      _count: { _all: true },
      _sum: { bytes: true },
    });
    res.json(byType.map((t) => ({ type: t.type, count: t._count._all, bytes: t._sum.bytes || 0 })));
  } catch (err) { next(err); }
});

module.exports = router;
