/**
 * معالج أخطاء مركزي: يحوّل أي استثناء غير متوقع إلى استجابة JSON موحّدة،
 * ويمنع تسرّب تفاصيل داخلية (Stack traces) في بيئة الإنتاج.
 */
function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err);

  const isProd = process.env.NODE_ENV === 'production';
  const status = err.status || 500;

  res.status(status).json({
    error: err.code || 'INTERNAL_ERROR',
    message: isProd ? 'حدث خطأ في الخادم، حاول مرة أخرى' : err.message,
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'NOT_FOUND', message: 'المسار غير موجود' });
}

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

module.exports = { errorHandler, notFoundHandler, ApiError };
