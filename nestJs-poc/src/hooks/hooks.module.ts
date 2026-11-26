import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HooksController } from './hooks.controller.js';
import { HooksService } from './hooks.service.js';
import { HookEvent } from './hook-event.entity.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([HookEvent]), AuthModule],
  controllers: [HooksController],
  providers: [HooksService, WebhookSignatureGuard],
})
export class HooksModule {}
