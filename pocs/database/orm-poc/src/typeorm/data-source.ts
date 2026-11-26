import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { HookEvent, Job, Node, ServiceConnection, User, Workflow } from './entities.js';

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.TYPEORM_URL ?? 'postgres://bench:bench@127.0.0.1:15434/typeorm',
  entities: [User, Workflow, Node, ServiceConnection, HookEvent, Job],
  migrations: [new URL('./migrations/*.js', import.meta.url).pathname],
});

export default dataSource;
