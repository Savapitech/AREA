import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { config } from './config.js';
import { dataSource } from './data-source.js';
import { errorHandler } from './errors.js';
import type { RawBodyRequest } from './middleware/verify-signature.js';
import { openapiDocument } from './openapi.js';
import { authRouter } from './routes/auth.js';
import { hooksRouter } from './routes/hooks.js';
import { startTimerHook } from './hooks/timer.js';

await dataSource.initialize();

const app = express();

app.use(express.json({ verify: (req, _res, buf) => { (req as RawBodyRequest).rawBody = buf; } }));

app.get('/docs/openapi.json', (_req, res) => { res.json(openapiDocument); });
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));

app.use('/auth', authRouter);
app.use('/hooks', hooksRouter);
app.use((_req, res) => { res.status(404).json({ statusCode: 404, message: 'Not found' }); });
app.use(errorHandler);

const stopTimerHook = startTimerHook();
const server = app.listen(config.port, () => console.log(`Express POC listening on ${config.port}`));

process.on('SIGTERM', () => {
  stopTimerHook();
  server.close(() => void dataSource.destroy());
});
