const express = require('express');
const { v4: uuid } = require('uuid');
const prisma = require('../db/prisma');
const { requireAuth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

function serializePost(post, likedByMe) {
  return {
    id: post.id,
    authorId: post.authorId,
    text: post.text,
    mediaItems: post.mediaJson ? JSON.parse(post.mediaJson) : [],
    poll: post.pollJson ? JSON.parse(post.pollJson) : null,
    hashtags: post.hashtagsJson ? JSON.parse(post.hashtagsJson) : [],
    mentionedUserIds: [],
    likesCount: post.likesCount,
    commentsCount: post.commentsCount,
    repostsCount: post.repostsCount,
    sharesCount: post.sharesCount,
    isLikedByMe: !!likedByMe,
    isSavedByMe: false,
    isRepost: post.isRepost,
    originalPostId: post.originalPostId,
    createdAtEpochMillis: post.createdAt.getTime(),
  };
}

router.get('/feed', requireAuth, async (req, res, next) => {
  try {
    const cursor = req.query.cursor;
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    const posts = await prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    const likes = await prisma.postLike.findMany({
      where: { userId: req.userId, postId: { in: posts.map((p) => p.id) } },
    });
    const likedSet = new Set(likes.map((l) => l.postId));

    res.json({
      items: posts.map((p) => serializePost(p, likedSet.has(p.id))),
      nextCursor: posts.length === limit ? posts[posts.length - 1].id : null,
    });
  } catch (err) { next(err); }
});

router.get('/user/:userId', requireAuth, async (req, res, next) => {
  try {
    const cursor = req.query.cursor;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const posts = await prisma.post.findMany({
      where: { authorId: req.params.userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    const likes = await prisma.postLike.findMany({ where: { userId: req.userId, postId: { in: posts.map((p) => p.id) } } });
    const likedSet = new Set(likes.map((l) => l.postId));
    res.json({
      items: posts.map((p) => serializePost(p, likedSet.has(p.id))),
      nextCursor: posts.length === limit ? posts[posts.length - 1].id : null,
    });
  } catch (err) { next(err); }
});

router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { text, mediaItems, poll, hashtags } = req.body;
    if (!text && (!mediaItems || mediaItems.length === 0) && !poll) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'المنشور يجب أن يحتوي نصًا أو وسائط أو استطلاعًا');
    }

    const post = await prisma.post.create({
      data: {
        id: uuid(),
        authorId: req.userId,
        text: text || null,
        mediaJson: mediaItems ? JSON.stringify(mediaItems) : null,
        pollJson: poll ? JSON.stringify(poll) : null,
        hashtagsJson: hashtags ? JSON.stringify(hashtags) : null,
      },
    });

    res.status(201).json(serializePost(post, false));
  } catch (err) { next(err); }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post) throw new ApiError(404, 'NOT_FOUND', 'المنشور غير موجود');
    if (post.authorId !== req.userId) throw new ApiError(403, 'FORBIDDEN', 'لا يمكنك حذف منشور غيرك');
    await prisma.post.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/:id/like', requireAuth, async (req, res, next) => {
  try {
    const { liked } = req.body;
    if (liked) {
      await prisma.postLike.upsert({
        where: { postId_userId: { postId: req.params.id, userId: req.userId } },
        create: { postId: req.params.id, userId: req.userId },
        update: {},
      });
      await prisma.post.update({ where: { id: req.params.id }, data: { likesCount: { increment: 1 } } });
    } else {
      const deleted = await prisma.postLike.deleteMany({ where: { postId: req.params.id, userId: req.userId } });
      if (deleted.count > 0) {
        await prisma.post.update({ where: { id: req.params.id }, data: { likesCount: { decrement: 1 } } });
      }
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/:id/repost', requireAuth, async (req, res, next) => {
  try {
    const original = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!original) throw new ApiError(404, 'NOT_FOUND', 'المنشور غير موجود');

    const repost = await prisma.post.create({
      data: {
        id: uuid(),
        authorId: req.userId,
        text: original.text,
        mediaJson: original.mediaJson,
        isRepost: true,
        originalPostId: original.id,
      },
    });
    await prisma.post.update({ where: { id: original.id }, data: { repostsCount: { increment: 1 } } });
    res.status(201).json(serializePost(repost, false));
  } catch (err) { next(err); }
});

router.get('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const comments = await prisma.comment.findMany({ where: { postId: req.params.id }, orderBy: { createdAt: 'asc' } });
    res.json(comments.map((c) => ({
      id: c.id, postId: c.postId, authorId: c.authorId, text: c.text, likesCount: 0,
      createdAtEpochMillis: c.createdAt.getTime(),
    })));
  } catch (err) { next(err); }
});

router.post('/:id/comments', requireAuth, async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text) throw new ApiError(400, 'VALIDATION_ERROR', 'نص التعليق مطلوب');

    const comment = await prisma.comment.create({
      data: { id: uuid(), postId: req.params.id, authorId: req.userId, text },
    });
    await prisma.post.update({ where: { id: req.params.id }, data: { commentsCount: { increment: 1 } } });

    res.status(201).json({
      id: comment.id, postId: comment.postId, authorId: comment.authorId, text: comment.text,
      likesCount: 0, createdAtEpochMillis: comment.createdAt.getTime(),
    });
  } catch (err) { next(err); }
});

router.post('/:id/poll/vote', requireAuth, async (req, res, next) => {
  try {
    const { optionId } = req.body;
    const post = await prisma.post.findUnique({ where: { id: req.params.id } });
    if (!post || !post.pollJson) throw new ApiError(404, 'NOT_FOUND', 'لا يوجد استطلاع لهذا المنشور');

    const poll = JSON.parse(post.pollJson);
    poll.options = poll.options.map((o) => (o.id === optionId ? { ...o, votesCount: (o.votesCount || 0) + 1 } : o));
    poll.hasVotedByMe = true;

    await prisma.post.update({ where: { id: req.params.id }, data: { pollJson: JSON.stringify(poll) } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
