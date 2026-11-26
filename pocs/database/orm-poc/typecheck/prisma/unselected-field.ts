import type { PrismaClient } from '../../src/prisma/generated/client.js';

declare const prisma: PrismaClient;

const user = await prisma.user.findFirst({ select: { id: true }, where: { email: 'alice@example.com' } });
console.log(user?.email.toUpperCase());
