import dataSource from '../../src/typeorm/data-source.js';
import { User, Workflow } from '../../src/typeorm/entities.js';

const user = await dataSource.getRepository(User).findOne({ select: { id: true, email: true }, where: { email: 'alice@example.com' } });
await dataSource.getRepository(Workflow).insert({ userId: 'id', name: 'name', config: { trigger: 'timer.tick' } });
console.log(user?.email.toUpperCase());
