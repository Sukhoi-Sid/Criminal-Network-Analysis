import jwt from 'jsonwebtoken';
import { UserRole } from '@sih/shared';
import { env } from '../../core/env';
import { UnauthorizedError } from '../../core/errors';

export interface AuthTokenPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
}

export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

export function verifyToken(token: string): AuthTokenPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}
