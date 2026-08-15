const express = require('express');
const prisma = require('../../db/prisma');
const { requireAdminAuth, requireRole } = require('../../middleware/adminAuth');
const { ApiError } = require('../../middleware/errorHandler');
const { logAdminAction } = require('../../services/auditLogger');

const router = express.Router();
router.use(requireAdminAuth);

function toAdminUserView(user, counts) {
  const { passwordHash, ...rest } = user;
  return { ...rest, ...counts };
}

/** GET /admin/users?query=&status=&page=&pageSize= — قائمة + بحث + تصفية */
router.get('/', requireRole('SUPPORT'), async (req, res, next) => {
  try {
    const query = String(req.query.query || '').trim();
    const status = String(req.query.status || 'all'); // all | banned | disabled | active | verified
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Number(req.query.pageSize) || 25, 100);

    const where = {
      AND: [
        query
          ? {
              OR: [
                { username: { contains: query, mode: 'insensitive' } },
                { displayName: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query, mode: 'insensitive' } },
                { id: query },
              ],
            }
          : {},
        status === 'banned' ? { isBanned: true } : {},
        status === 'disabled' ? { isDisabled: true } : {},
        status === 'active' ? { isBanned: false, isDisabled: false } : {},
        status === 'verified' ? { isVerified: true } : {},
      ],
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      items: users.map((u) => toAdminUserView(u)),
      total, page, pageSize, totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) { next(err); }
});

/** GET /admin/users/:id — تفاصيل + إحصائيات المستخدم */
router.get('/:id', requireRole('SUPPORT'), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'المستخدم غير موجود');

    const [postsCount, messagesCount, roomsCount, followersCount, followingCount, activeSessions, reportsAgainst] = await Promise.all([
      prisma.post.count({ where: { authorId: user.id } }),
      prisma.message.count({ where: { senderId: user.id } }),
      prisma.roomMember.count({ where: { userId: user.id } }),
      prisma.follow.count({ where: { followingId: user.id } }),
      prisma.follow.count({ where: { followerId: user.id } }),
      prisma.refreshToken.count({ where: { userId: user.id, revoked: false, expiresAt: { gt: new Date() } } }),
      prisma.report.count({ where: { targetType: 'USER', targetId: user.id } }),
    ]);

    res.json(toAdminUserView(user, {
      postsCount, messagesCount, roomsCount, followersCount, followingCount, activeSessions, reportsAgainst,
    }));
  } catch (err) { next(err); }
});

/** PATCH /admin/users/:id — تعديل بيانات المستخدم */
router.patch('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { displayName, username, bio, avatarUrl, coverUrl } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(username !== undefined && { username }),
        ...(bio !== undefined && { bio }),
        ...(avatarUrl !== undefined && { avatarUrl }),
        ...(coverUrl !== undefined && { coverUrl }),
      },
    });
    await logAdminAction({ adminId: req.adminId, action: 'USER_UPDATED', targetType: 'USER', targetId: user.id, metadata: req.body });
    res.json(toAdminUserView(user));
  } catch (err) { next(err); }
});

/** POST /admin/users/:id/ban */
router.post('/:id/ban', requireRole('MODERATOR'), async (req, res, next) => {
  try {
    const { reason } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isBanned: true, bannedReason: reason || null, bannedAt: new Date() },
    });
    await prisma.refreshToken.updateMany({ where: { userId: user.id }, data: { revoked: true } });
    await logAdminAction({ adminId: req.adminId, action: 'USER_BANNED', targetType: 'USER', targetId: user.id, metadata: { reason } });
    res.json(toAdminUserView(user));
  } catch (err) { next(err); }
});

/** POST /admin/users/:id/unban */
router.post('/:id/unban', requireRole('MODERATOR'), async (req, res, next) => {
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { isBanned: false, bannedReason: null, bannedAt: null },
    });
    await logAdminAction({ adminId: req.adminId, action: 'USER_UNBANNED', targetType: 'USER', targetId: user.id });
    res.json(toAdminUserView(user));
  } catch (err) { next(err); }
});

/** POST /admin/users/:id/disable | /enable — تعطيل مؤقت (أخف من الحظر) */
router.post('/:id/disable', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isDisabled: true } });
    await logAdminAction({ adminId: req.adminId, action: 'USER_DISABLED', targetType: 'USER', targetId: user.id });
    res.json(toAdminUserView(user));
  } catch (err) { next(err); }
});

router.post('/:id/enable', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isDisabled: false } });
    await logAdminAction({ adminId: req.adminId, action: 'USER_ENABLED', targetType: 'USER', targetId: user.id });
    res.json(toAdminUserView(user));
  } catch (err) { next(err); }
});

/** DELETE /admin/users/:id — حذف نهائي (SUPER_ADMIN/ADMIN فقط) */
router.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await logAdminAction({ adminId: req.adminId, action: 'USER_DELETED', targetType: 'USER', targetId: req.params.id });
    await prisma.user.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

/** إدارة الأجهزة/الجلسات: عرض الجلسات النشطة وإبطالها فرديًا أو كلها */
router.get('/:id/sessions', requireRole('SUPPORT'), async (req, res, next) => {
  try {
    const sessions = await prisma.refreshToken.findMany({
      where: { userId: req.params.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, deviceInfo: true, createdAt: true, expiresAt: true, revoked: true },
    });
    res.json(sessions);
  } catch (err) { next(err); }
});

router.delete('/:id/sessions/:sessionId', requireRole('MODERATOR'), async (req, res, next) => {
  try {
    await prisma.refreshToken.update({ where: { id: req.params.sessionId }, data: { revoked: true } });
    await logAdminAction({ adminId: req.adminId, action: 'SESSION_REVOKED', targetType: 'USER', targetId: req.params.id, metadata: { sessionId: req.params.sessionId } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.delete('/:id/sessions', requireRole('MODERATOR'), async (req, res, next) => {
  try {
    await prisma.refreshToken.updateMany({ where: { userId: req.params.id }, data: { revoked: true } });
    await logAdminAction({ adminId: req.adminId, action: 'ALL_SESSIONS_REVOKED', targetType: 'USER', targetId: req.params.id });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
