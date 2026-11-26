import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from './config.js';
import { User } from './entities/user.js';
import { HookEvent } from './entities/hook-event.js';

export const dataSource = new DataSource({
  type: 'postgres',
  ...config.db,
  entities: [User, HookEvent],
  synchronize: true,
});

export const users = () => dataSource.getRepository(User);
export const hookEvents = () => dataSource.getRepository(HookEvent);
