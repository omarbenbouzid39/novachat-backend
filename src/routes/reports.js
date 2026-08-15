const express = require('express');
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

const VALID_TARGET_TYPES = ['USER', 'POST', 'ROOM', 'MESSAGE', 'COMMENT'];

/**
 * POST /reports — يُستدعى من تطبيق Android عند إبلاغ المستخدم عن حساب/
 * منشور/رسالة/غرفة. يظهر البلاغ فورًا في لوحة تحكم الإدارة (Moderation)
 * بحالة PENDING.
 */
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { targetType, targetId, reason, details } = req.body;

    if (!VALID_TARGET_TYPES.includes(targetType)) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'نوع الهدف غير مدعوم');
    }
    if (!targetId || !reason) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'targetId وreason مطلوبان');
    }

    const report = await prisma.report.create({
      data: { reporterId: req.userId, targetType, targetId, reason, details: details || null },
    });

    res.status(201).json({
      id: report.id, targetType: report.targetType, targetId: report.targetId,
      status: report.status, createdAtEpochMillis: report.createdAt.getTime(),
    });
  } catch (err) { next(err); }
});

/** GET /reports/mine — بلاغاتي السابقة (اختياري، لعرض حالة البلاغ للمستخدم) */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const reports = await prisma.report.findMany({
      where: { reporterId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(reports.map((r) => ({
      id: r.id, targetType: r.targetType, targetId: r.targetId, reason: r.reason,
      status: r.status, createdAtEpochMillis: r.createdAt.getTime(),
    })));
  } catch (err) { next(err); }
});

module.exports = router;
