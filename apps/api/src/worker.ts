// Worker entrypoint (run as a separate process: `pnpm --filter @geo/api worker`).
// Consumes the shared BullMQ queues. Regular scans are platform-neutral; Deep
// Scan needs platform access (catalog/site), so its worker is wired here where
// the adapters live — the platform port is injected into the core orchestrator.
import { Worker, type ConnectionOptions } from "bullmq";
import { registerScheduler, startWorkers, redis, DEEP_SCANS_QUEUE, type DeepScanJob } from "@geo/core/queue";
import { runDeepScan } from "@geo/core/deep-scan";
import { adaptersFor } from "./adapters";

await registerScheduler();
startWorkers();

const connection = redis as unknown as ConnectionOptions;
const deepScanWorker = new Worker<DeepScanJob>(
  DEEP_SCANS_QUEUE,
  (job) => runDeepScan(job.data.deepScanId, { resolvePlatform: async (t) => (await adaptersFor(t)).platform }),
  { connection, concurrency: 1 }, // one deep scan at a time — heavy, many provider calls
);
deepScanWorker.on("failed", (job, err) => console.error(`[worker] deep-scan ${job?.id} failed:`, err.message));

console.log("[worker] geo worker up (scans + scheduler + deep-scans)");
