import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { User } from './user.entity.js';

export type AuthenticatedRequest = Request & { user: User };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

    if (!token) {
      throw new UnauthorizedException();
    }

    let payload: { sub: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException();
    }

    const user = await this.authService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }

    request.user = user;
    return true;
  }
}
