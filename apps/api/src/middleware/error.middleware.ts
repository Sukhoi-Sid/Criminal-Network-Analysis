import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { ApiError } from '@sih/shared';
import {
  ApplicationError,
  DatabaseError,
  FileError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../core/errors';

function statusForError(err: ApplicationError): number {
  if (err instanceof ValidationError) return 400;
  if (err instanceof UnauthorizedError) return 401;
  if (err instanceof ForbiddenError) return 403;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof DatabaseError) return 500;
  if (err instanceof FileError) return 500;
  return 500;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const body: ApiError = {
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: err.flatten(),
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof ApplicationError) {
    const body: ApiError = {
      error: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {}),
    };
    res.status(statusForError(err)).json(body);
    return;
  }

  // Unknown/unexpected error — never leak internals to the client.
  // eslint-disable-next-line no-console
  console.error('Unhandled error:', err);
  const body: ApiError = { error: 'Internal server error', code: 'INTERNAL_ERROR' };
  res.status(500).json(body);
}
