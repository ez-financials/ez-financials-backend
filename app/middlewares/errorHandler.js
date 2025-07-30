export function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let message = err.message || 'Internal Server Error';
  let details = undefined;

  // Joi validation error
  if (err.isJoi) {
    status = 400;
    message = 'Validation Error';
    details = err.details?.map(d => d.message);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    status = 400;
    message = 'Mongoose Validation Error';
    details = Object.values(err.errors).map(e => e.message);
  }

  // Mongoose duplicate key error
  if (err.code && err.code === 11000) {
    status = 409;
    message = 'Duplicate Key Error';
    details = err.keyValue;
  }

  // CastError (e.g., invalid ObjectId)
  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid value for field: ${err.path}`;
    details = [err.message];
  }

  res.status(status).json({
    success: false,
    error: {
      code: status,
      message,
      reason: err.reason || undefined,
      details,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    },
  });
}
