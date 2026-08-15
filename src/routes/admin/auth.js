const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const prisma = require('../../db/prisma');
const { authLimiter } = require('../../middleware/rateLimiter');
const { requireAdminAuth } = require('../../middleware/adminAuth');
const { ApiError } = require('../../middleware/errorHandler');
const {
  signAdminAccessToken, signAdminRefreshToken, signAdmin2FAPendingToken,
  verifyAdminRefreshToken, verifyAdmin2FAPendingToken,
} = require('../../utils/adminJwt');
const totp = require('../../utils/totp');

const router = express.Router();

function toPublicAdmin(admin) {
  const { passwordHash, twoFactorSecret, ...rest } = admin;
  return rest;
}

async function issueAdminSession(admin, deviceInfo) {
  const accessToken = signAdminAccessToken(admin.id, admin.role);
  const refreshToken = signAdminRefreshToken(admin.id);

  await prisma.adminRefreshToken.create({
    data: {
      token: refreshToken,
      adminId: admin.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      deviceInfo: deviceInfo || null,
    },
  });
  await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

  return { accessToken, refreshToken, admin: toPublicAdmin(admin) };
}

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'بيانات الدخول غير صحيحة');
    const { email, password } = parsed.data;

    const admin = await prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !admin.isActive) throw new ApiError(401, 'INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة');

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة');

    if (admin.twoFactorEnabled) {
      const tempToken = signAdmin2FAPendingToken(admin.id);
      return res.json({ requires2FA: true, tempToken });
    }

    // ملاحظة أمنية: SUPER_ADMIN بلا 2FA مفعّل يُسمح له بالدخول هنا لكن
    // يُنصح بشدة بإجباره على /2fa/setup فور أول دخول من واجهة لوحة التحكم.
    const session = await issueAdminSession(admin, req.headers['user-agent']);
    res.json({ requires2FA: false, ...session });
  } catch (err) { next(err); }
});

router.post('/2fa/verify', authLimiter, async (req, res, next) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) throw new ApiError(400, 'VALIDATION_ERROR', 'tempToken وcode مطلوبان');

    let payload;
    try {
      payload = verifyAdmin2FAPendingToken(tempToken);
    } catch {
      throw new ApiError(401, 'TOKEN_EXPIRED_OR_INVALID', 'انتهت مهلة إدخال رمز التحقق، أعد تسجيل الدخول');
    }

    const admin = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.twoFactorSecret) throw new ApiError(401, 'INVALID_CREDENTIALS', 'حساب غير صالح');

    const valid = totp.verifyToken(admin.twoFactorSecret, code);
    if (!valid) throw new ApiError(401, 'INVALID_2FA_CODE', 'رمز التحقق غير صحيح');

    const session = await issueAdminSession(admin, req.headers['user-agent']);
    res.json(session);
  } catch (err) { next(err); }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new ApiError(400, 'VALIDATION_ERROR', 'refreshToken مطلوب');

    let payload;
    try { payload = verifyAdminRefreshToken(refreshToken); }
    catch { throw new ApiError(401, 'REFRESH_TOKEN_INVALID', 'الجلسة منتهية، سجّل الدخول مجددًا'); }

    const stored = await prisma.adminRefreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      throw new ApiError(401, 'REFRESH_TOKEN_INVALID', 'الجلسة منتهية، سجّل الدخول مجددًا');
    }

    const admin = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive) throw new ApiError(401, 'REFRESH_TOKEN_INVALID', 'الحساب غير نشط');

    await prisma.adminRefreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
    const session = await issueAdminSession(admin, stored.deviceInfo);
    res.json(session);
  } catch (err) { next(err); }
});

router.post('/logout', requireAdminAuth, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.adminRefreshToken.updateMany({ where: { token: refreshToken, adminId: req.adminId }, data: { revoked: true } });
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get('/me', requireAdminAuth, async (req, res) => {
  res.json(toPublicAdmin(req.admin));
});

// ---------- إعداد 2FA (يتطلب تسجيل دخول إداري أولًا) ----------

router.post('/2fa/setup', requireAdminAuth, async (req, res, next) => {
  try {
    const secret = totp.generateSecret();
    const otpAuthUrl = totp.getOtpAuthUrl(secret, req.admin.email);
    const qrCodeDataUrl = await totp.getQrCodeDataUrl(otpAuthUrl);

    // يُخزَّن مؤقتًا وغير مفعّل حتى يؤكد المدير الرمز عبر /2fa/enable
    await prisma.adminUser.update({ where: { id: req.adminId }, data: { twoFactorSecret: secret, twoFactorEnabled: false } });

    res.json({ secret, otpAuthUrl, qrCodeDataUrl });
  } catch (err) { next(err); }
});

router.post('/2fa/enable', requireAdminAuth, async (req, res, next) => {
  try {
    const { code } = req.body;
    const admin = await prisma.adminUser.findUnique({ where: { id: req.adminId } });
    if (!admin.twoFactorSecret) throw new ApiError(400, 'NOT_SETUP', 'ابدأ بـ /2fa/setup أولًا');

    if (!totp.verifyToken(admin.twoFactorSecret, code)) {
      throw new ApiError(400, 'INVALID_2FA_CODE', 'رمز التحقق غير صحيح');
    }

    await prisma.adminUser.update({ where: { id: req.adminId }, data: { twoFactorEnabled: true } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/2fa/disable', requireAdminAuth, async (req, res, next) => {
  try {
    await prisma.adminUser.update({ where: { id: req.adminId }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
