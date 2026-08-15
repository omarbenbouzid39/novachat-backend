const express = require('express');
const prisma = require('../../db/prisma');
const { requireAdminAuth, requireRole } = require('../../middleware/adminAuth');

const router = express.Router();
router.use(requireAdminAuth);

/** GET /admin/audit-log?adminId=&targetType=&page= — SUPER_ADMIN وADMIN فقط */
router.get('/', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { adminId, targetType } = req.query;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = 50;

    const where = { ...(adminId && { adminId }), ...(targetType && { targetType }) };

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize, take: pageSize,
        include: { admin: { select: { displayName: true, email: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ items: logs, total, page, totalPages: Math.ceil(total / pageSize) });
  } catch (err) { next(err); }
});

module.exports = router;
