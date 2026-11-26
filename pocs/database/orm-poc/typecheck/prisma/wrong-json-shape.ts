import type { PrismaClient } from '../../src/prisma/generated/client.js';

declare const prisma: PrismaClient;

await prisma.workflow.create({ data: { userId: 'id', name: 'name', config: { trigger: 42 } } });
