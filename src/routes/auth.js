const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const { z } = require('zod');
const prisma = require('../db/prisma');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { authLimiter } = require('../middleware/rateLimiter');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

const REFRESH_EXPIRY_DAYS = 30;

function toPublicUser(user) {
  const { passwordHash, ...publicUser } = user;
  return publicUser;
}

async function issueSession(user, deviceInfo) {
  const accessToken = signAccessToken(user.id);
  const refreshToken = signRefreshToken(user.id);

  await prisma.refreshToken.create({
    data: {
      id: uuid(),
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      deviceInfo: deviceInfo || null,
    },
  });

  return { accessToken, refreshToken, user: toPublicUser(user) };
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'),
  username: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_.]+$/, 'اسم المستخدم يجب أن يحتوي أحرفًا/أرقامًا فقط'),
  displayName: z.string().min(1).max(60).optional(),
});

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.errors[0]?.message || 'بيانات غير صحيحة');
    const { email, password, username, displayName } = parsed.data;

    const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
    if (existing) throw new ApiError(409, 'USER_EXISTS', 'البريد الإلكتروني أو اسم المستخدم مستخدم بالفعل');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        id: uuid(),
        email,
        username,
        passwordHash,
        displayName: displayName || username,
        authProvider: 'EMAIL',
      },
    });

    const session = await issueSession(user, req.headers['user-agent']);
    res.status(201).json(session);
  } catch (err) { next(err); }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) throw new ApiError(401, 'INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'بيانات الدخول غير صحيحة');

    await prisma.user.update({ where: { id: user.id }, data: { isOnline: true, lastSeenAt: new Date() } });

    const session = await issueSession(user, req.headers['user-agent']);
    res.json(session);
  } catch (err) { next(err); }
});

router.post('/guest', authLimiter, async (req, res, next) => {
  try {
    const guestId = uuid();
    const user = await prisma.user.create({
      data: {
        id: guestId,
        username: `guest_${guestId.slice(0, 8)}`,
        displayName: 'ضيف',
        authProvider: 'GUEST',
      },
    });
    const session = await issueSession(user, req.headers['user-agent']);
    res.status(201).json(session);
  } catch (err) { next(err); }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new ApiError(400, 'VALIDATION_ERROR', 'refreshToken مطلوب');

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw new ApiError(401, 'REFRESH_TOKEN_INVALID', 'انتهت صلاحية الجلسة، الرجاء تسجيل الدخول مجددًا');
    }

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });
    if (!stored || stored.revoked || stored.expiresAt < new Date()) {
      throw new ApiError(401, 'REFRESH_TOKEN_INVALID', 'انتهت صلاحية الجلسة، الرجاء تسجيل الدخول مجددًا');
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new ApiError(401, 'REFRESH_TOKEN_INVALID', 'المستخدم غير موجود');

    // تدوير التوكن (Token Rotation): إبطال القديم وإصدار جديد لكل من access/refresh
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revoked: true } });
    const session = await issueSession(user, stored.deviceInfo);

    res.json(session);
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken, userId: req.userId },
        data: { revoked: true },
      });
    }
    await prisma.user.update({ where: { id: req.userId }, data: { isOnline: false, lastSeenAt: new Date() } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/logout-all', requireAuth, async (req, res, next) => {
  try {
    await prisma.refreshToken.updateMany({ where: { userId: req.userId }, data: { revoked: true } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
