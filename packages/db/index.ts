// Single Prisma client for the whole monorepo. Import `{ prisma }` from "@geo/db"
// everywhere; never `new PrismaClient()` in app code (connection storms).
import { PrismaClient } from "./generated/client/index.js";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export * from "./generated/client/index.js";
export type { PrismaClient };
