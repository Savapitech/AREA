import type { Request, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { users } from '../data-source.js';
import { HttpError } from '../errors.js';
import type { User } from '../entities/user.js';

export type AuthenticatedRequest = Request & { user: User };

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) {
    throw new HttpError(401, 'Unauthorized');
  }

  let payload: jwt.JwtPayload | string;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Unauthorized');
  }

  const user = typeof payload === 'object' && payload.sub ? await users().findOneBy({ id: payload.sub }) : null;
  if (!user) {
    throw new HttpError(401, 'Unauthorized');
  }

  (req as AuthenticatedRequest).user = user;
  next();
};
