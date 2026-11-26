import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { Owned, Store, WorkflowConfig, WorkflowInput } from '../store.js';
import * as schema from './schema.js';
import { hookEvents, jobs, nodes, serviceConnections, users, workflows } from './schema.js';

const url = process.env.DRIZZLE_URL ?? 'postgres://bench:bench@127.0.0.1:15434/drizzle';

export class DrizzleStore implements Store {
  readonly name = 'Drizzle';
  private readonly pool = new pg.Pool({ connectionString: url });
  private readonly db = drizzle(this.pool, { schema });

  async setup() {
    await migrate(this.db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  }

  async close() {
    await this.pool.end();
  }

  async createUser(email: string) {
    const [user] = await this.db.insert(users).values({ email }).returning({ id: users.id });
    return user.id;
  }

  async connectService(userId: string, service: string) {
    await this.db.insert(serviceConnections).values({ userId, service });
  }

  createWorkflow(userId: string, input: WorkflowInput) {
    return this.db.transaction(async (tx) => {
      const [workflow] = await tx.insert(workflows).values({ userId, name: input.name, config: { trigger: input.trigger } }).returning({ id: workflows.id });
      await tx.insert(nodes).values(
        input.reactions.map((reaction, index) => ({ workflowId: workflow.id, position: index + 1, type: reaction.type, params: reaction.params })),
      );
      return workflow.id;
    });
  }

  async listWorkflows(userId: string) {
    const rows = await this.db.query.workflows.findMany({
      where: (workflow, { eq: equals }) => equals(workflow.userId, userId),
      with: { nodes: { orderBy: (node, { asc }) => [asc(node.position)] } },
      orderBy: (workflow, { asc }) => [asc(workflow.name)],
    });
    return rows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      trigger: workflow.config.trigger,
      nodes: workflow.nodes.map((node) => ({ position: node.position, type: node.type, params: node.params })),
    }));
  }

  countByTrigger(trigger: string) {
    return this.db.$count(workflows, sql`${workflows.config} ->> 'trigger' = ${trigger}`);
  }

  async deleteUser(userId: string) {
    await this.db.delete(users).where(eq(users.id, userId));
  }

  async countOwned(userId: string, workflowIds: string[]): Promise<Owned> {
    return {
      workflows: await this.db.$count(workflows, eq(workflows.userId, userId)),
      nodes: workflowIds.length ? await this.db.$count(nodes, inArray(nodes.workflowId, workflowIds)) : 0,
      connections: await this.db.$count(serviceConnections, eq(serviceConnections.userId, userId)),
    };
  }

  async recordOccurrence(source: string, externalId: string) {
    const rows = await this.db.insert(hookEvents).values({ source, externalId }).onConflictDoNothing().returning({ id: hookEvents.id });
    return rows.length === 1;
  }

  async addJobs(count: number) {
    await this.db.insert(jobs).values(Array.from({ length: count }, () => ({ claimedBy: null })));
  }

  claimJob(worker: number) {
    return this.db.transaction(async (tx) => {
      const [job] = await tx.select({ id: jobs.id }).from(jobs).where(isNull(jobs.claimedBy)).orderBy(jobs.id).limit(1).for('update', { skipLocked: true });
      if (!job) {
        return null;
      }
      await tx.update(jobs).set({ claimedBy: worker }).where(and(eq(jobs.id, job.id)));
      return job.id;
    });
  }

  async insertWorkflowWithoutTrigger(userId: string) {
    await this.db.insert(workflows).values({ userId, name: 'no trigger', config: {} as WorkflowConfig });
  }
}
