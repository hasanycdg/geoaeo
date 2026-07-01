// Standalone worker process entrypoint. Run with `npm run worker`.
// Registers the repeatable scheduler tick, then starts the workers.
import "dotenv/config";
import { registerScheduler } from "./queue.server";
import { startWorkers } from "./worker.server";

async function main() {
  await registerScheduler();
  startWorkers();
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
