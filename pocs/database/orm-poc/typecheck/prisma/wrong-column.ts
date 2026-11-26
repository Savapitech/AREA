import type { PrismaClient } from '../../src/prisma/generated/client.js';

declare const prisma: PrismaClient;

await prisma.user.findFirst({ where: { emial: 'alice@example.com' } });
