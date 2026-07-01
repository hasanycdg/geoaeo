// Worker entrypoint (run as a separate process: `pnpm --filter @geo/api worker`).
// Consumes the shared BullMQ queues and runs scans for tenants of ANY platform —
// the scan is platform-neutral, so no adapter is needed here.
import { registerScheduler, startWorkers } from "@geo/core/queue";

await registerScheduler();
startWorkers();
console.log("[worker] geo worker up");
