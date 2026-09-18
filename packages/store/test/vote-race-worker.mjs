import { register } from "node:module";
import { parentPort, workerData } from "node:worker_threads";

register(workerData.resolverUrl, import.meta.url);
const { SqliteStore } = await import(workerData.storeUrl);
const store = new SqliteStore(workerData.file);
parentPort.once("message", async () => {
  try {
    await store.upsertVote(workerData.vote);
    parentPort.postMessage({ ok: true, vote: workerData.vote.vote });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: error.code, message: error.message });
  } finally {
    store.close();
    parentPort.close();
  }
});
parentPort.postMessage({ ready: true });
