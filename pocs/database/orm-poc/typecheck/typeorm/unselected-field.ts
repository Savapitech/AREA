import dataSource from '../../src/typeorm/data-source.js';
import { User, Workflow } from '../../src/typeorm/entities.js';

const user = await dataSource.getRepository(User).findOne({ select: { id: true }, where: { email: 'alice@example.com' } });
console.log(user?.email.toUpperCase());
