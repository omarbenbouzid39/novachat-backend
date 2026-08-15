const express = require('express');
const prisma = require('../../db/prisma');
const { requireAdminAuth, requireRole } = require('../../middleware/adminAuth');
const { logAdminAction } = require('../../services/auditLogger');

const router = express.Router();
router.use(requireAdminAuth, requireRole('MODERATOR'));

/** GET /admin/posts?query=&page=&pageSize= */
router.get('/', async (req, res, next) => {
  try {
    const query = String(req.query.query || '').trim();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Number(req.query.pageSize) || 25, 100);

    const where = query ? { text: { contains: query, mode: 'insensitive' } } : {};

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
        include: { author: { select: { id: true, username: true, displayName: true } } },
      }),
      prisma.post.count({ where }),
    ]);

    res.json({ items: posts, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await logAdminAction({ adminId: req.adminId, action: 'POST_DELETED', targetType: 'POST', targetId: req.params.id });
    await prisma.post.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

/** تثبيت/إلغاء تثبيت منشور بإضافة حقل بسيط عبر جدول منفصل غير مطلوب حاليًا؛
 * نُعيد استخدام hashtagsJson لتخزين علامة "pinned" ضمن معطيات بسيطة، أو
 * الأفضل إضافة عمود isPinned مستقبلًا. هنا نكتفي بالحذف/الإخفاء الفعلي. */
router.post('/:id/hide', async (req, res, next) => {
  try {
    // إخفاء ناعم: نفرّغ النص والوسائط لإخفاء المحتوى مع إبقاء السجل للتدقيق
    const post = await prisma.post.update({
      where: { id: req.params.id },
      data: { text: '[تم إخفاء هذا المنشور من قبل الإدارة]', mediaJson: null },
    });
    await logAdminAction({ adminId: req.adminId, action: 'POST_HIDDEN', targetType: 'POST', targetId: post.id });
    res.json(post);
  } catch (err) { next(err); }
});

router.delete('/comments/:id', async (req, res, next) => {
  try {
    const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
    if (comment) {
      await prisma.post.update({ where: { id: comment.postId }, data: { commentsCount: { decrement: 1 } } }).catch(() => {});
    }
    await prisma.comment.delete({ where: { id: req.params.id } });
    await logAdminAction({ adminId: req.adminId, action: 'COMMENT_DELETED', targetType: 'MESSAGE', targetId: req.params.id });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
