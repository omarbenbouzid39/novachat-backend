const prisma = require('../db/prisma');

/**
 * يسجّل كل إجراء إداري حسّاس (حظر، حذف، قبول/رفض توثيق...) في سجل دائم
 * غير قابل للتعديل من واجهة لوحة التحكم — يُعرض فقط للـ SUPER_ADMIN/ADMIN.
 */
async function logAdminAction({ adminId, action, targetType, targetId, metadata }) {
  await prisma.auditLog.create({
    data: {
      adminId,
      action,
      targetType,
      targetId: targetId || null,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
    },
  });
}

module.exports = { logAdminAction };
