import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../src/drizzle/schema.js';
import { users, workflows } from '../../src/drizzle/schema.js';

declare const db: NodePgDatabase<typeof schema>;

await db.insert(workflows).values({ userId: 'id', name: 'name', config: { trigger: 42 } });
