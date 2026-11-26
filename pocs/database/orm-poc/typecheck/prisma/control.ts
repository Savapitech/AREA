import type { PrismaClient } from '../../src/prisma/generated/client.js';

declare const prisma: PrismaClient;

const user = await prisma.user.findFirst({ select: { id: true, email: true }, where: { email: 'alice@example.com' } });
await prisma.workflow.create({ data: { userId: 'id', name: 'name', config: { trigger: 'timer.tick' } } });
console.log(user?.email.toUpperCase());
