import { Check, Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique } from 'typeorm';
import type { NodeParams, WorkflowConfig } from '../store.js';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  email: string;

  @OneToMany(() => Workflow, (workflow) => workflow.user)
  workflows: Workflow[];
}

@Entity('workflows')
@Check('workflow_has_trigger', `"config" -> 'trigger' IS NOT NULL`)
export class Workflow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, (user) => user.workflows, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'jsonb' })
  config: WorkflowConfig;

  @OneToMany(() => Node, (node) => node.workflow)
  nodes: Node[];
}

@Entity('nodes')
@Unique(['workflowId', 'position'])
export class Node {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  workflowId: string;

  @ManyToOne(() => Workflow, (workflow) => workflow.nodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_id' })
  workflow: Workflow;

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'jsonb' })
  params: NodeParams;
}

@Entity('service_connections')
@Unique(['userId', 'service'])
export class ServiceConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'text' })
  service: string;
}

@Entity('hook_events')
@Unique(['source', 'externalId'])
export class HookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  source: string;

  @Column({ name: 'external_id', type: 'text' })
  externalId: string;
}

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'claimed_by', type: 'int', nullable: true })
  claimedBy: number | null;
}
