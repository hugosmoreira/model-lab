import { register } from "node:module";
import { parentPort, workerData } from "node:worker_threads";
register("./ts-resolve.mjs", import.meta.url);
const { SqliteStore } = await import("../src/sqlite.ts");
const store = new SqliteStore(workerData.file);
parentPort.once("message", async () => {
  try {
    await store.insertAnnotation(workerData.annotation);
    parentPort.postMessage({ ok: true });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: error.code });
  } finally {
    store.close();
    parentPort.close();
  }
});
parentPort.postMessage({ ready: true });
