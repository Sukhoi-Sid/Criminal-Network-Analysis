import { Router } from 'express';
import { z } from 'zod';
import type { AuthLoginResponse, UserDto } from '@sih/shared';
import { authService } from './auth.service';
import { authenticate } from '../../middleware/auth.middleware';
import { toUserDto } from '../../core/serialize';
import { NotFoundError } from '../../core/errors';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res) => {
  const body = loginSchema.parse(req.body);
  const result = await authService.login({
    email: body.email,
    password: body.password,
    ipAddress: req.ip,
  });

  const response: AuthLoginResponse = {
    token: result.token,
    user: toUserDto(result.user),
  };
  res.status(200).json(response);
});

authRouter.get('/me', authenticate, async (req, res) => {
  const user = await authService.getById(req.user!.id);
  if (!user) {
    throw new NotFoundError('User not found');
  }
  const dto: UserDto = toUserDto(user);
  res.status(200).json(dto);
});
