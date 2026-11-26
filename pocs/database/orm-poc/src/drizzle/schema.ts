import { relations, sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, serial, text, unique, uuid } from 'drizzle-orm/pg-core';
import type { NodeParams, WorkflowConfig } from '../store.js';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
});

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    config: jsonb('config').$type<WorkflowConfig>().notNull(),
  },
  (table) => [check('workflow_has_trigger', sql`${table.config} -> 'trigger' IS NOT NULL`)],
);

export const nodes = pgTable(
  'nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: text('type').notNull(),
    params: jsonb('params').$type<NodeParams>().notNull(),
  },
  (table) => [unique().on(table.workflowId, table.position)],
);

export const serviceConnections = pgTable(
  'service_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    service: text('service').notNull(),
  },
  (table) => [unique().on(table.userId, table.service)],
);

export const hookEvents = pgTable(
  'hook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
  },
  (table) => [unique().on(table.source, table.externalId)],
);

export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  claimedBy: integer('claimed_by'),
});

export const workflowRelations = relations(workflows, ({ many }) => ({ nodes: many(nodes) }));

export const nodeRelations = relations(nodes, ({ one }) => ({
  workflow: one(workflows, { fields: [nodes.workflowId], references: [workflows.id] }),
}));
