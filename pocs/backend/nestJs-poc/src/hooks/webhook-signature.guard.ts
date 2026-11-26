import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const header = request.headers['x-hook-signature'];

    if (typeof header !== 'string' || !request.rawBody) {
      throw new UnauthorizedException('Missing signature');
    }

    const expected = createHmac('sha256', this.config.getOrThrow<string>('HOOK_SECRET'))
      .update(request.rawBody)
      .digest('hex');
    const received = Buffer.from(header.replace(/^sha256=/, ''), 'utf8');

    if (received.length !== expected.length || !timingSafeEqual(received, Buffer.from(expected, 'utf8'))) {
      throw new UnauthorizedException('Invalid signature');
    }

    return true;
  }
}
