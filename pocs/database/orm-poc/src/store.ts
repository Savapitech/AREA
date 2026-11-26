export type WorkflowConfig = { trigger: string };

export type NodeParams = Record<string, string | number | boolean>;

export type WorkflowInput = {
  name: string;
  trigger: string;
  reactions: { type: string; params: NodeParams }[];
};

export type WorkflowView = {
  id: string;
  name: string;
  trigger: string;
  nodes: { position: number; type: string; params: NodeParams }[];
};

export type Owned = { workflows: number; nodes: number; connections: number };

export interface Store {
  readonly name: string;
  setup(): Promise<void>;
  close(): Promise<void>;
  createUser(email: string): Promise<string>;
  connectService(userId: string, service: string): Promise<void>;
  createWorkflow(userId: string, input: WorkflowInput): Promise<string>;
  listWorkflows(userId: string): Promise<WorkflowView[]>;
  countByTrigger(trigger: string): Promise<number>;
  deleteUser(userId: string): Promise<void>;
  countOwned(userId: string, workflowIds: string[]): Promise<Owned>;
  recordOccurrence(source: string, externalId: string): Promise<boolean>;
  addJobs(count: number): Promise<void>;
  claimJob(worker: number): Promise<number | null>;
  insertWorkflowWithoutTrigger(userId: string): Promise<void>;
}
