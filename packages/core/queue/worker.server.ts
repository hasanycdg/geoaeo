// Worker process. Run separately from the web server (`npm run worker`).
//   tenant-scan  — delegates to runTenantScan (shared core, platform-neutral).
//   weekly-tick  — fans out tenant-scan jobs for ALL tenants (Shopify + WordPress)
//                  with active prompts. The scan only queries LLMs, so no adapter
//                  is needed here regardless of platform.
import { Worker, type ConnectionOptions } from "bullmq";
import { prisma } from "@geo/db";
import { redis } from "./redis.server";
import { SCANS_QUEUE, SCHEDULER_QUEUE, enqueueTenantScan, type TenantScanJob } from "./queue.server";
import { runTenantScan } from "../scan/shop-scan.server";

async function processWeeklyTick() {
  const tenants = await prisma.tenant.findMany({
    where: { prompts: { some: { isActive: true } }, brandName: { not: null } },
    select: { id: true },
  });
  for (const t of tenants) await enqueueTenantScan(t.id, "scheduled");
  return { enqueued: tenants.length };
}

export function startWorkers() {
  const connection = redis as unknown as ConnectionOptions;
  const scanWorker = new Worker<TenantScanJob>(SCANS_QUEUE, (job) => runTenantScan(job.data.tenantId), {
    connection,
    concurrency: 2, // bounds simultaneous provider calls
    limiter: { max: 30, duration: 60_000 }, // ≤30 scan jobs/min
  });

  const schedulerWorker = new Worker(SCHEDULER_QUEUE, processWeeklyTick, {
    connection,
    concurrency: 1,
  });

  for (const w of [scanWorker, schedulerWorker]) {
    w.on("failed", (job, err) => console.error(`[worker] ${job?.name} failed:`, err.message));
  }
  console.log("[worker] geo-scans + geo-scheduler workers started");
  return { scanWorker, schedulerWorker };
}
