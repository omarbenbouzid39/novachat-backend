const express = require('express');
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/register-token', requireAuth, async (req, res, next) => {
  try {
    const { token, platform } = req.body;
    if (!token) return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'token مطلوب' });

    await prisma.pushToken.upsert({
      where: { token },
      create: { userId: req.userId, token, platform: platform || 'android' },
      update: { userId: req.userId },
    });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.delete('/register-token', requireAuth, async (req, res, next) => {
  try {
    const { token } = req.body;
    if (token) await prisma.pushToken.deleteMany({ where: { token, userId: req.userId } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
