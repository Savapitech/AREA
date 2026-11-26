import dataSource from '../../src/typeorm/data-source.js';
import { User, Workflow } from '../../src/typeorm/entities.js';

await dataSource.getRepository(Workflow).insert({ userId: 'id', name: 'name', config: { trigger: 42 } });
