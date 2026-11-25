import { Module } from '@nestjs/common';
import { HooksController } from './hooks.controller.js';
import { HooksService } from './hooks.service.js';

@Module({
  controllers: [HooksController],
  providers: [HooksService]
})
export class HooksModule {}
