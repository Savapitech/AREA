import { In } from 'typeorm';
import type { Owned, Store, WorkflowConfig, WorkflowInput } from '../store.js';
import dataSource from './data-source.js';
import { HookEvent, Job, Node, ServiceConnection, User, Workflow } from './entities.js';

export class TypeormStore implements Store {
  readonly name = 'TypeORM';

  async setup() {
    await dataSource.initialize();
    await dataSource.runMigrations();
  }

  async close() {
    await dataSource.destroy();
  }

  async createUser(email: string) {
    return (await dataSource.getRepository(User).save({ email })).id;
  }

  async connectService(userId: string, service: string) {
    await dataSource.getRepository(ServiceConnection).insert({ userId, service });
  }

  createWorkflow(userId: string, input: WorkflowInput) {
    return dataSource.transaction(async (manager) => {
      const workflow = await manager.getRepository(Workflow).save({ userId, name: input.name, config: { trigger: input.trigger } });
      await manager.getRepository(Node).insert(
        input.reactions.map((reaction, index) => ({ workflowId: workflow.id, position: index + 1, type: reaction.type, params: reaction.params })),
      );
      return workflow.id;
    });
  }

  async listWorkflows(userId: string) {
    const workflows = await dataSource.getRepository(Workflow).find({
      where: { userId },
      relations: { nodes: true },
      order: { name: 'ASC', nodes: { position: 'ASC' } },
    });
    return workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      trigger: workflow.config.trigger,
      nodes: workflow.nodes.map((node) => ({ position: node.position, type: node.type, params: node.params })),
    }));
  }

  countByTrigger(trigger: string) {
    return dataSource.getRepository(Workflow).createQueryBuilder('workflow').where("workflow.config ->> 'trigger' = :trigger", { trigger }).getCount();
  }

  async deleteUser(userId: string) {
    await dataSource.getRepository(User).delete({ id: userId });
  }

  async countOwned(userId: string, workflowIds: string[]): Promise<Owned> {
    return {
      workflows: await dataSource.getRepository(Workflow).countBy({ userId }),
      nodes: await dataSource.getRepository(Node).countBy({ workflowId: In(workflowIds) }),
      connections: await dataSource.getRepository(ServiceConnection).countBy({ userId }),
    };
  }

  async recordOccurrence(source: string, externalId: string) {
    const result = await dataSource.getRepository(HookEvent).createQueryBuilder().insert().values({ source, externalId }).orIgnore().execute();
    return result.raw.length === 1;
  }

  async addJobs(count: number) {
    await dataSource.getRepository(Job).insert(Array.from({ length: count }, () => ({ claimedBy: null })));
  }

  claimJob(worker: number) {
    return dataSource.transaction(async (manager) => {
      const job = await manager
        .getRepository(Job)
        .createQueryBuilder('job')
        .where('job.claimed_by IS NULL')
        .orderBy('job.id')
        .limit(1)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getOne();
      if (!job) {
        return null;
      }
      await manager.getRepository(Job).update(job.id, { claimedBy: worker });
      return job.id;
    });
  }

  async insertWorkflowWithoutTrigger(userId: string) {
    await dataSource.getRepository(Workflow).insert({ userId, name: 'no trigger', config: {} as WorkflowConfig });
  }
}
