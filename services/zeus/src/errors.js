import logger from './utils/logger.js';

export class AppError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

// Обертка для асинхронных route handlers
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Middleware для обработки ошибок
export const errorHandler = (err, req, res, next) => {
  logger.error(err);
  
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details && { details: err.details })
    });
  }

  // Для неожиданных ошибок не раскрываем детали
  res.status(500).json({
    error: 'Internal server error'
  });
};
