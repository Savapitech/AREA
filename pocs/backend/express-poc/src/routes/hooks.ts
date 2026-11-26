import { Router } from 'express';
import { z } from 'zod';
import { hookEvents } from '../data-source.js';
import { recordEvent } from '../hooks/store.js';
import { requireAuth } from '../middleware/require-auth.js';
import { validateBody } from '../middleware/validate.js';
import { verifySignature } from '../middleware/verify-signature.js';

const webhookSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
}).strict();

type WebhookBody = z.infer<typeof webhookSchema>;

export const hooksRouter = Router();

hooksRouter.post('/webhook', verifySignature, validateBody(webhookSchema), async (req, res) => {
  const { eventId, eventType, payload } = req.body as WebhookBody;
  const isNew = await recordEvent('webhook', eventId, { eventType, ...payload });
  res.json({ received: true, duplicate: !isNew });
});

hooksRouter.get('/events', requireAuth, async (_req, res) => {
  res.json(await hookEvents().find({ order: { receivedAt: 'DESC' }, take: 20 }));
});
