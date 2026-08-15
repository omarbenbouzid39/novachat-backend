const express = require('express');
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const { generateUploadSignature } = require('../services/cloudinary');

const router = express.Router();

/**
 * يعيد توقيعًا مؤقتًا يستخدمه تطبيق Android للرفع المباشر والآمن إلى
 * Cloudinary (بدون تمرير الملف عبر خادمنا). صالح لبضع دقائق فقط بحكم
 * الـ timestamp المضمّن في التوقيع.
 */
router.post('/sign', requireAuth, async (req, res, next) => {
  try {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      throw new ApiError(503, 'MEDIA_NOT_CONFIGURED', 'خدمة رفع الوسائط غير مُهيّأة بعد على الخادم (بيانات Cloudinary مفقودة)');
    }
    const { resourceType, folder } = req.body;
    const signature = generateUploadSignature({
      folder: folder || `novachat/${req.userId}`,
      resourceType,
    });
    res.json(signature);
  } catch (err) { next(err); }
});

/**
 * يُستدعى من التطبيق فور نجاح الرفع المباشر إلى Cloudinary، فقط لتسجيل
 * بيانات وصفية خفيفة (النوع، الحجم بالبايت، الرابط) تُستخدم في إحصائيات
 * لوحة التحكم (استهلاك التخزين حسب النوع). لا يُخزَّن أي ملف هنا.
 */
router.post('/confirm', requireAuth, async (req, res, next) => {
  try {
    const { type, url, bytes } = req.body;
    if (!type || !url) throw new ApiError(400, 'VALIDATION_ERROR', 'type وurl مطلوبان');

    await prisma.mediaAsset.create({
      data: { uploadedById: req.userId, type, url, bytes: bytes || null },
    });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
