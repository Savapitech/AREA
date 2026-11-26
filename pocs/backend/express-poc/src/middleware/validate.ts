import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export function validateBody(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        statusCode: 400,
        message: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
