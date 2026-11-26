import type { ErrorRequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.statusCode).json({ statusCode: error.statusCode, message: error.message });
    return;
  }
  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    res.status(400).json({ statusCode: 400, message: 'Malformed JSON body' });
    return;
  }
  console.error(error);
  res.status(500).json({ statusCode: 500, message: 'Internal server error' });
};
