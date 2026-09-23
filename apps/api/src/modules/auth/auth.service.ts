import { AuditAction, AuditResourceType, UserRole } from '@sih/shared';
import type { UserRole as PrismaUserRole } from '@prisma/client';
import { prisma } from '../../core/db';
import { UnauthorizedError, ValidationError } from '../../core/errors';
import { auditService } from '../audit/audit.service';
import { hashPassword, verifyPassword } from './password';
import { signToken } from './jwt';

export interface LoginResult {
  token: string;
  user: { id: string; email: string; name: string; role: UserRole; createdAt: Date };
}

export class AuthService {
  /**
   * Not exposed as a public self-signup endpoint — investigators/supervisors
   * are provisioned by an admin (or the seed script). Kept here so admin
   * user-management routes can call it once that surface exists.
   */
  async createUser(input: { email: string; password: string; name: string; role: UserRole }) {
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ValidationError('A user with this email already exists');
    }
    const passwordHash = await hashPassword(input.password);
    return prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        name: input.name,
        role: input.role as unknown as PrismaUserRole,
      },
    });
  }

  async login(input: { email: string; password: string; ipAddress?: string }): Promise<LoginResult> {
    const user = await prisma.user.findUnique({ where: { email: input.email } });

    if (!user) {
      await auditService.emit({
        actorEmail: input.email,
        action: AuditAction.LOGIN_FAILED,
        resourceType: AuditResourceType.SESSION,
        ipAddress: input.ipAddress ?? null,
        metadata: { reason: 'user_not_found' },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      await auditService.emit({
        actorId: user.id,
        actorEmail: user.email,
        action: AuditAction.LOGIN_FAILED,
        resourceType: AuditResourceType.SESSION,
        ipAddress: input.ipAddress ?? null,
        metadata: { reason: 'bad_password' },
      });
      throw new UnauthorizedError('Invalid email or password');
    }

    const token = signToken({ sub: user.id, email: user.email, role: user.role as unknown as UserRole });

    await auditService.emit({
      actorId: user.id,
      actorEmail: user.email,
      action: AuditAction.LOGIN,
      resourceType: AuditResourceType.SESSION,
      ipAddress: input.ipAddress ?? null,
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as unknown as UserRole,
        createdAt: user.createdAt,
      },
    };
  }

  async getById(userId: string) {
    return prisma.user.findUnique({ where: { id: userId } });
  }
}

export const authService = new AuthService();
