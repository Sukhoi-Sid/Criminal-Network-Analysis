import type { NextFunction, Request, Response } from 'express';
import { Permission, ROLE_PERMISSIONS, UserRole } from '@sih/shared';
import { verifyToken } from '../modules/auth/jwt';
import { ForbiddenError, UnauthorizedError } from '../core/errors';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Verifies the bearer JWT and attaches `req.user`. Every route below
 * `/api/*` except `/api/auth/login` requires this.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }
  const token = header.slice('Bearer '.length).trim();
  const payload = verifyToken(token);
  req.user = { id: payload.sub, email: payload.email, role: payload.role };
  next();
}

/** RBAC gate: caller's role must grant at least one of `permissions`. */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError();
    }
    const granted = ROLE_PERMISSIONS[req.user.role] ?? [];
    const hasAny = permissions.some((p) => granted.includes(p));
    if (!hasAny) {
      throw new ForbiddenError(`Requires one of: ${permissions.join(', ')}`);
    }
    next();
  };
}

