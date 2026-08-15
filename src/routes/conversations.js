const express = require('express');
const { v4: uuid } = require('uuid');
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const { sendPushToTokens } = require('../services/push');

const router = express.Router();

function serializeMessage(m) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    type: m.type,
    text: m.text,
    mediaItems: m.mediaJson ? JSON.parse(m.mediaJson) : [],
    replyToMessageId: m.replyToMessageId,
    forwardedFromUserId: m.forwardedFromUserId,
    reactions: m.reactionsJson ? JSON.parse(m.reactionsJson) : {},
    status: m.status,
    isEdited: m.isEdited,
    isDeletedForEveryone: m.isDeletedForEveryone,
    isPinned: m.isPinned,
    createdAtEpochMillis: m.createdAt.getTime(),
    editedAtEpochMillis: m.editedAt ? m.editedAt.getTime() : null,
  };
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const memberships = await prisma.conversationParticipant.findMany({
      where: { userId: req.userId },
      include: {
        conversation: {
          include: {
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
            participants: true,
          },
        },
      },
      orderBy: { conversation: { updatedAt: 'desc' } },
    });

    const result = memberships.map((membership) => {
      const conversation = membership.conversation;
      const lastMessage = conversation.messages[0];
      return {
        id: conversation.id,
        type: conversation.type,
        title: conversation.title,
        avatarUrl: conversation.avatarUrl,
        participantIds: conversation.participants.map((p) => p.userId),
        lastMessage: lastMessage ? serializeMessage(lastMessage) : null,
        unreadCount: membership.unreadCount,
        isMuted: membership.isMuted,
        isPinned: membership.isPinned,
        updatedAtEpochMillis: conversation.updatedAt.getTime(),
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { type, memberIds, title } = req.body;
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'memberIds مطلوبة');
    }

    const allParticipantIds = Array.from(new Set([req.userId, ...memberIds]));

    const conversation = await prisma.conversation.create({
      data: {
        id: uuid(),
        type: type === 'GROUP' ? 'GROUP' : 'PRIVATE',
        title: type === 'GROUP' ? title : null,
        participants: { create: allParticipantIds.map((userId) => ({ userId })) },
      },
      include: { participants: true },
    });

    res.status(201).json({
      id: conversation.id,
      type: conversation.type,
      title: conversation.title,
      participantIds: conversation.participants.map((p) => p.userId),
      unreadCount: 0,
      isMuted: false,
      isPinned: false,
      updatedAtEpochMillis: conversation.updatedAt.getTime(),
    });
  } catch (err) { next(err); }
});

async function assertParticipant(conversationId, userId) {
  const membership = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
  });
  if (!membership) throw new ApiError(403, 'FORBIDDEN', 'لست عضوًا في هذه المحادثة');
  return membership;
}

router.get('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    await assertParticipant(req.params.id, req.userId);
    const before = req.query.before ? new Date(Number(req.query.before)) : undefined;
    const limit = Math.min(Number(req.query.limit) || 30, 100);

    const messages = await prisma.message.findMany({
      where: { conversationId: req.params.id, ...(before && { createdAt: { lt: before } }) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    res.json(messages.reverse().map(serializeMessage));
  } catch (err) { next(err); }
});

router.post('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    await assertParticipant(req.params.id, req.userId);
    const { type, text, mediaItems, replyToMessageId } = req.body;

    const message = await prisma.message.create({
      data: {
        id: uuid(),
        conversationId: req.params.id,
        senderId: req.userId,
        type: type || 'TEXT',
        text: text || null,
        mediaJson: mediaItems ? JSON.stringify(mediaItems) : null,
        replyToMessageId: replyToMessageId || null,
        status: 'SENT',
      },
    });

    await prisma.conversation.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: req.params.id, userId: { not: req.userId } },
      data: { unreadCount: { increment: 1 } },
    });

    req.app.locals.realtime?.notifyNewMessage(req.params.id, message.id, req.userId);

    // إشعار Push لبقية المشاركين غير المتصلين حاليًا (اختياري، يحتاج Firebase مُهيّأ)
    try {
      const others = await prisma.conversationParticipant.findMany({
        where: { conversationId: req.params.id, userId: { not: req.userId } },
        include: { user: { include: { pushTokens: true } } },
      });
      const tokens = others.flatMap((p) => p.user.pushTokens.map((t) => t.token));
      if (tokens.length > 0) {
        await sendPushToTokens(tokens, { title: 'رسالة جديدة', body: text || 'وسائط جديدة', data: { conversationId: req.params.id } });
      }
    } catch { /* Push غير مُهيّأ بعد؛ لا يوقف تدفق إرسال الرسالة */ }

    res.status(201).json(serializeMessage(message));
  } catch (err) { next(err); }
});

router.patch('/messages/:messageId', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.message.findUnique({ where: { id: req.params.messageId } });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'الرسالة غير موجودة');
    if (existing.senderId !== req.userId) throw new ApiError(403, 'FORBIDDEN', 'لا يمكنك تعديل رسالة غيرك');

    const updated = await prisma.message.update({
      where: { id: req.params.messageId },
      data: { text: req.body.text, isEdited: true, editedAt: new Date() },
    });
    res.json(serializeMessage(updated));
  } catch (err) { next(err); }
});

router.delete('/messages/:messageId', requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.message.findUnique({ where: { id: req.params.messageId } });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'الرسالة غير موجودة');

    const forEveryone = req.query.forEveryone === 'true';
    if (forEveryone && existing.senderId !== req.userId) {
      throw new ApiError(403, 'FORBIDDEN', 'لا يمكنك حذف رسالة غيرك للجميع');
    }

    if (forEveryone) {
      await prisma.message.update({ where: { id: req.params.messageId }, data: { isDeletedForEveryone: true, text: null, mediaJson: null } });
    } else {
      await prisma.message.delete({ where: { id: req.params.messageId } });
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/messages/:messageId/pin', requireAuth, async (req, res, next) => {
  try {
    const updated = await prisma.message.update({
      where: { id: req.params.messageId },
      data: { isPinned: !!req.body.pinned },
    });
    res.json(serializeMessage(updated));
  } catch (err) { next(err); }
});

router.post('/messages/:messageId/reactions', requireAuth, async (req, res, next) => {
  try {
    const { emoji, add } = req.body;
    const message = await prisma.message.findUnique({ where: { id: req.params.messageId } });
    if (!message) throw new ApiError(404, 'NOT_FOUND', 'الرسالة غير موجودة');

    const reactions = message.reactionsJson ? JSON.parse(message.reactionsJson) : {};
    const current = new Set(reactions[emoji] || []);
    if (add) current.add(req.userId); else current.delete(req.userId);
    reactions[emoji] = Array.from(current);

    const updated = await prisma.message.update({
      where: { id: req.params.messageId },
      data: { reactionsJson: JSON.stringify(reactions) },
    });
    res.json(serializeMessage(updated));
  } catch (err) { next(err); }
});

router.post('/:id/read', requireAuth, async (req, res, next) => {
  try {
    await prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: req.params.id, userId: req.userId } },
      data: { unreadCount: 0, lastReadAt: new Date() },
    });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
