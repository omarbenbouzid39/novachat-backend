const { WebSocketServer } = require('ws');
const { verifyAccessToken } = require('../utils/jwt');

/**
 * خادم WebSocket خفيف يطابق بروتوكول JSON البسيط المتوقع من عميل
 * Android (WebSocketRealtimeService.kt). كل اتصال يُوثَّق عبر access
 * token يُمرَّر في Query String (?token=...) عند الاتصال.
 *
 * بروتوكول الرسائل (JSON):
 *  -> من العميل: { "type": "typing", "conversationId": "...", "isTyping": true }
 *  <- من الخادم: { "type": "new_message", "conversationId": "...", "messageId": "..." }
 *  <- من الخادم: { "type": "typing", "conversationId": "...", "userId": "...", "isTyping": true }
 *  <- من الخادم: { "type": "presence", "userId": "...", "isOnline": true }
 *  <- من الخادم: { "type": "message_status", "messageId": "...", "status": "READ" }
 */
function attachRealtimeServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  // userId -> Set<WebSocket> (يدعم أكثر من جهاز لنفس المستخدم في آنٍ واحد)
  const connectionsByUser = new Map();

  wss.on('connection', (socket, request) => {
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token');

    let userId;
    try {
      const payload = verifyAccessToken(token);
      userId = payload.sub;
    } catch {
      socket.close(4001, 'Unauthorized');
      return;
    }

    if (!connectionsByUser.has(userId)) connectionsByUser.set(userId, new Set());
    connectionsByUser.get(userId).add(socket);
    broadcastPresence(userId, true);

    socket.on('message', (raw) => {
      let event;
      try {
        event = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (event.type === 'typing' && event.conversationId) {
        broadcastToConversationParticipants(event.conversationId, {
          type: 'typing',
          conversationId: event.conversationId,
          userId,
          isTyping: !!event.isTyping,
        }, userId);
      }
    });

    socket.on('close', () => {
      const set = connectionsByUser.get(userId);
      if (set) {
        set.delete(socket);
        if (set.size === 0) {
          connectionsByUser.delete(userId);
          broadcastPresence(userId, false);
        }
      }
    });
  });

  function sendToUser(userId, payload) {
    const sockets = connectionsByUser.get(userId);
    if (!sockets) return;
    const json = JSON.stringify(payload);
    sockets.forEach((s) => { if (s.readyState === 1) s.send(json); });
  }

  function broadcastPresence(userId, isOnline) {
    // بث بسيط لكل المتصلين حاليًا؛ في نظام كبير يُقيَّد هذا لمن يتابع المستخدم فقط
    connectionsByUser.forEach((_, otherUserId) => {
      if (otherUserId !== userId) sendToUser(otherUserId, { type: 'presence', userId, isOnline });
    });
  }

  // يُستدعى من مسارات REST (مثال: بعد إرسال رسالة) لإخطار بقية المشاركين
  const prisma = require('../db/prisma');
  async function broadcastToConversationParticipants(conversationId, payload, excludeUserId) {
    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    participants
      .filter((p) => p.userId !== excludeUserId)
      .forEach((p) => sendToUser(p.userId, payload));
  }

  return {
    sendToUser,
    broadcastToConversationParticipants,
    notifyNewMessage: (conversationId, messageId, senderId) =>
      broadcastToConversationParticipants(conversationId, { type: 'new_message', conversationId, messageId }, senderId),
    notifyMessageStatus: (userId, messageId, status) =>
      sendToUser(userId, { type: 'message_status', messageId, status }),
  };
}

module.exports = { attachRealtimeServer };
