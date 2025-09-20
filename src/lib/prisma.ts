import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

// Prevent multiple instances of Prisma Client in development
const prisma = globalThis.__prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: process.env.DB_CONNECTION_STRING
    }
  }
});

if (process.env.NODE_ENV !== 'production') {
  globalThis.__prisma = prisma;
}

// Handle Prisma connection errors
prisma.$on('error', (e) => {
  console.error('Prisma error:', e);
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export { prisma };
