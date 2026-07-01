// Shared ioredis connection for BullMQ. BullMQ requires maxRetriesPerRequest:null.
import { Redis } from "ioredis";

declare global {
  // eslint-disable-next-line no-var
  var __geoRedis: Redis | undefined;
}

export const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis =
  global.__geoRedis ??
  new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });

if (process.env.NODE_ENV !== "production") global.__geoRedis = redis;
