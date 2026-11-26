import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgres://bench:bench@127.0.0.1:15434/prisma',
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL ?? 'postgres://bench:bench@127.0.0.1:15434/prisma_shadow',
  },
});
