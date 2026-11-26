import { PrismaPg } from '@prisma/adapter-pg';
import { execFileSync } from 'node:child_process';
import type { NodeParams, Owned, Store, WorkflowInput } from '../store.js';
import { PrismaClient } from './generated/client.js';

const url = process.env.PRISMA_URL ?? 'postgres://bench:bench@127.0.0.1:15434/prisma';

export class PrismaStore implements Store {
  readonly name = 'Prisma';
  private readonly prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  async setup() {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
    await this.prisma.$connect();
  }

  async close() {
    await this.prisma.$disconnect();
  }

  async createUser(email: string) {
    return (await this.prisma.user.create({ data: { email }, select: { id: true } })).id;
  }

  async connectService(userId: string, service: string) {
    await this.prisma.serviceConnection.create({ data: { userId, service } });
  }

  async createWorkflow(userId: string, input: WorkflowInput) {
    const workflow = await this.prisma.workflow.create({
      data: {
        userId,
        name: input.name,
        config: { trigger: input.trigger },
        nodes: { create: input.reactions.map((reaction, index) => ({ position: index + 1, type: reaction.type, params: reaction.params })) },
      },
      select: { id: true },
    });
    return workflow.id;
  }

  async listWorkflows(userId: string) {
    const workflows = await this.prisma.workflow.findMany({
      where: { userId },
      include: { nodes: { orderBy: { position: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      trigger: (workflow.config as { trigger: string }).trigger,
      nodes: workflow.nodes.map((node) => ({ position: node.position, type: node.type, params: node.params as NodeParams })),
    }));
  }

  countByTrigger(trigger: string) {
    return this.prisma.workflow.count({ where: { config: { path: ['trigger'], equals: trigger } } });
  }

  async deleteUser(userId: string) {
    await this.prisma.user.delete({ where: { id: userId } });
  }

  async countOwned(userId: string, workflowIds: string[]): Promise<Owned> {
    return {
      workflows: await this.prisma.workflow.count({ where: { userId } }),
      nodes: await this.prisma.node.count({ where: { workflowId: { in: workflowIds } } }),
      connections: await this.prisma.serviceConnection.count({ where: { userId } }),
    };
  }

  async recordOccurrence(source: string, externalId: string) {
    const result = await this.prisma.hookEvent.createMany({ data: [{ source, externalId }], skipDuplicates: true });
    return result.count === 1;
  }

  async addJobs(count: number) {
    await this.prisma.job.createMany({ data: Array.from({ length: count }, () => ({ claimedBy: null })) });
  }

  claimJob(worker: number) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM jobs WHERE claimed_by IS NULL ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) {
        return null;
      }
      await tx.job.update({ where: { id: rows[0].id }, data: { claimedBy: worker } });
      return rows[0].id;
    });
  }

  async insertWorkflowWithoutTrigger(userId: string) {
    await this.prisma.workflow.create({ data: { userId, name: 'no trigger', config: { reactions: [] } } });
  }
}
