import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { users } from '../data-source.js';
import { HttpError, isUniqueViolation } from '../errors.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/require-auth.js';

const authSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
}).strict();

type AuthBody = z.infer<typeof authSchema>;

export const authRouter = Router();

authRouter.post('/register', validateBody(authSchema), async (req, res) => {
  const { email, password } = req.body as AuthBody;

  if (await users().findOneBy({ email })) {
    throw new HttpError(409, 'Email already registered');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const saved = await users().save(users().create({ email, passwordHash }));
    res.status(201).json({ id: saved.id, email: saved.email });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, 'Email already registered');
    }
    throw error;
  }
});

authRouter.post('/login', validateBody(authSchema), async (req, res) => {
  const { email, password } = req.body as AuthBody;
  const user = await users().findOneBy({ email });

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const access_token = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  res.json({ access_token });
});

authRouter.get('/me', requireAuth, (req, res) => {
  const { user } = req as AuthenticatedRequest;
  res.json({ id: user.id, email: user.email });
});
