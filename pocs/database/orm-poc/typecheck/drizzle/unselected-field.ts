import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../src/drizzle/schema.js';
import { users, workflows } from '../../src/drizzle/schema.js';

declare const db: NodePgDatabase<typeof schema>;

const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'alice@example.com'));
console.log(user.email.toUpperCase());
