import pg from 'pg';
import { readFileSync } from 'node:fs';
import type { NodeParams, Owned, Store, WorkflowInput } from '../store.js';

const url = process.env.PG_URL ?? 'postgres://bench:bench@127.0.0.1:15434/pg';

type WorkflowRow = { id: string; name: string; trigger: string; position: number | null; type: string | null; params: NodeParams | null };

export class PgStore implements Store {
  readonly name = 'pg alone';
  private readonly pool = new pg.Pool({ connectionString: url });

  async setup() {
    await this.pool.query(readFileSync(new URL('../../src/pg/schema.sql', import.meta.url), 'utf8'));
  }

  async close() {
    await this.pool.end();
  }

  async createUser(email: string) {
    return (await this.pool.query<{ id: string }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [email])).rows[0].id;
  }

  async connectService(userId: string, service: string) {
    await this.pool.query('INSERT INTO service_connections (user_id, service) VALUES ($1, $2)', [userId, service]);
  }

  async createWorkflow(userId: string, input: WorkflowInput) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>('INSERT INTO workflows (user_id, name, config) VALUES ($1, $2, $3) RETURNING id', [
        userId,
        input.name,
        { trigger: input.trigger },
      ]);
      await client.query(
        `INSERT INTO nodes (workflow_id, position, type, params)
         SELECT $1, node.position, node.type, node.params
         FROM unnest($2::int[], $3::text[], $4::jsonb[]) AS node(position, type, params)`,
        [
          rows[0].id,
          input.reactions.map((_, index) => index + 1),
          input.reactions.map((reaction) => reaction.type),
          input.reactions.map((reaction) => JSON.stringify(reaction.params)),
        ],
      );
      await client.query('COMMIT');
      return rows[0].id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listWorkflows(userId: string) {
    const { rows } = await this.pool.query<WorkflowRow>(
      `SELECT w.id, w.name, w.config ->> 'trigger' AS trigger, n.position, n.type, n.params
       FROM workflows w LEFT JOIN nodes n ON n.workflow_id = w.id
       WHERE w.user_id = $1 ORDER BY w.name, n.position`,
      [userId],
    );
    const byId = new Map<string, { id: string; name: string; trigger: string; nodes: { position: number; type: string; params: NodeParams }[] }>();
    for (const row of rows) {
      const workflow = byId.get(row.id) ?? { id: row.id, name: row.name, trigger: row.trigger, nodes: [] };
      byId.set(row.id, workflow);
      if (row.position !== null && row.type !== null && row.params !== null) {
        workflow.nodes.push({ position: row.position, type: row.type, params: row.params });
      }
    }
    return [...byId.values()];
  }

  async countByTrigger(trigger: string) {
    return Number((await this.pool.query<{ n: string }>("SELECT COUNT(*) AS n FROM workflows WHERE config ->> 'trigger' = $1", [trigger])).rows[0].n);
  }

  async deleteUser(userId: string) {
    await this.pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }

  async countOwned(userId: string, workflowIds: string[]): Promise<Owned> {
    const count = async (sql: string, value: unknown) => Number((await this.pool.query<{ n: string }>(sql, [value])).rows[0].n);
    return {
      workflows: await count('SELECT COUNT(*) AS n FROM workflows WHERE user_id = $1', userId),
      nodes: await count('SELECT COUNT(*) AS n FROM nodes WHERE workflow_id = ANY($1::uuid[])', workflowIds),
      connections: await count('SELECT COUNT(*) AS n FROM service_connections WHERE user_id = $1', userId),
    };
  }

  async recordOccurrence(source: string, externalId: string) {
    const { rowCount } = await this.pool.query('INSERT INTO hook_events (source, external_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [source, externalId]);
    return rowCount === 1;
  }

  async addJobs(count: number) {
    await this.pool.query('INSERT INTO jobs (claimed_by) SELECT NULL FROM generate_series(1, $1)', [count]);
  }

  async claimJob(worker: number) {
    const { rows } = await this.pool.query<{ id: number }>(
      `UPDATE jobs SET claimed_by = $1
       WHERE id = (SELECT id FROM jobs WHERE claimed_by IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING id`,
      [worker],
    );
    return rows[0]?.id ?? null;
  }

  async insertWorkflowWithoutTrigger(userId: string) {
    await this.pool.query('INSERT INTO workflows (user_id, name, config) VALUES ($1, $2, $3)', [userId, 'no trigger', {}]);
  }
}
