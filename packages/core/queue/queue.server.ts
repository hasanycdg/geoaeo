// Queue definitions. Two queues:
//   geo-scans     — heavy per-shop scan jobs (the rate-limited LLM work).
//   geo-scheduler — a repeatable tick that fans out scan jobs for due shops.
// LLM queries NEVER run in the request cycle — only here, off the web process.
import { Queue, type ConnectionOptions } from "bullmq";
import { redis } from "./redis.server";

// BullMQ ships its own ioredis types; our ioredis is a different copy, so the
// instance needs a cast to satisfy ConnectionOptions. Runtime is unaffected.
const connection = redis as unknown as ConnectionOptions;

export const SCANS_QUEUE = "geo-scans";
export const SCHEDULER_QUEUE = "geo-scheduler";

export interface TenantScanJob {
  tenantId: string;
  trigger: "scheduled" | "manual";
}

type ScanQueue = Queue<TenantScanJob, unknown, string>;

declare global {
  // eslint-disable-next-line no-var
  var __geoQueues: { scans: ScanQueue; scheduler: Queue } | undefined;
}

function build() {
  return {
    scans: new Queue<TenantScanJob, unknown, string>(SCANS_QUEUE, { connection }),
    scheduler: new Queue(SCHEDULER_QUEUE, { connection }),
  };
}

const queues = global.__geoQueues ?? build();
if (process.env.NODE_ENV !== "production") global.__geoQueues = queues;

export const scansQueue = queues.scans;
export const schedulerQueue = queues.scheduler;

/** Enqueue a scan for one shop (used by the scheduler and by manual "scan now"). */
export async function enqueueTenantScan(tenantId: string, trigger: TenantScanJob["trigger"]) {
  return scansQueue.add(
    "shop-scan",
    { tenantId, trigger },
    {
      // Idempotency: one scheduled scan per shop per day max (manual bypasses).
      jobId: trigger === "scheduled" ? `scan:${tenantId}:${todayKey()}` : undefined,
      attempts: 2,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  );
}

/** Register the repeatable weekly tick (idempotent — safe to call on every boot). */
export async function registerScheduler() {
  await schedulerQueue.add(
    "weekly-tick",
    {},
    {
      repeat: { pattern: "0 6 * * 1" }, // Mondays 06:00 (server TZ)
      jobId: "weekly-tick",
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
