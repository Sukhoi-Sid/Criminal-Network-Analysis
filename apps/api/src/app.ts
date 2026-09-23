import 'express-async-errors';
import express, { type Express } from 'express';
import cors from 'cors';
import { env } from './core/env';
import { checkDatabaseConnection } from './core/db';
import { authRouter } from './modules/auth/auth.routes';
import { auditRouter } from './modules/audit/audit.routes';
import { caseRouter } from './modules/case-platform/case.routes';
import { evidenceRouter } from './modules/evidence-store/evidence.routes';
import { errorMiddleware } from './middleware/error.middleware';

export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '5mb' }));

  // Verifies real PostgreSQL connectivity via Prisma rather than just
  // confirming the process is up. Never returns error details/connection
  // info — only a boolean-derived status — so this can't be used to probe
  // internal infrastructure.
  app.get('/health', async (_req, res) => {
    const databaseOk = await checkDatabaseConnection();
    if (!databaseOk) {
      res.status(503).json({ status: 'error', service: 'sih-26189-api', database: 'unavailable' });
      return;
    }
    res.status(200).json({ status: 'ok', service: 'sih-26189-api', database: 'connected' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/cases', caseRouter);
  // evidence-store mounts its own /cases/:caseId/documents + /documents/:id +
  // /evidence-records/:id paths under this prefix.
  app.use('/api', evidenceRouter);

  // Must be registered last — express-async-errors forwards thrown/rejected
  // errors from async route handlers here.
  app.use(errorMiddleware);

  return app;
}
