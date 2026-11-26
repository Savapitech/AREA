import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HookEvent } from './hook-event.entity.js';

const TIMER_PERIOD_MS = 60_000;

@Injectable()
export class HooksService {
  private readonly logger = new Logger(HooksService.name);

  constructor(
    @InjectRepository(HookEvent)
    private readonly events: Repository<HookEvent>,
  ) {}

  @Interval(10_000)
  async pollTimer() {
    const occurrence = Math.floor(Date.now() / TIMER_PERIOD_MS);
    const isNew = await this.record('timer', String(occurrence), {
      tickAt: new Date(occurrence * TIMER_PERIOD_MS).toISOString(),
    });

    if (isNew) {
      this.logger.log(`timer.tick ${occurrence} detected, workflow would start here`);
    }
  }

  async record(source: string, externalId: string, payload: Record<string, unknown> | null) {
    try {
      await this.events.save(this.events.create({ source, externalId, payload }));
      return true;
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        return false;
      }
      throw error;
    }
  }

  latest() {
    return this.events.find({ order: { receivedAt: 'DESC' }, take: 20 });
  }
}
