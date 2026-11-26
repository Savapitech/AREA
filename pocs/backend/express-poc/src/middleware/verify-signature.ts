import type { Request, RequestHandler } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../errors.js';

export type RawBodyRequest = Request & { rawBody?: Buffer };

export const verifySignature: RequestHandler = (req, _res, next) => {
  const header = req.headers['x-hook-signature'];
  const rawBody = (req as RawBodyRequest).rawBody;

  if (typeof header !== 'string' || !rawBody) {
    throw new HttpError(401, 'Missing signature');
  }

  const expected = Buffer.from(createHmac('sha256', config.hookSecret).update(rawBody).digest('hex'), 'utf8');
  const received = Buffer.from(header.replace(/^sha256=/, ''), 'utf8');

  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new HttpError(401, 'Invalid signature');
  }

  next();
};
