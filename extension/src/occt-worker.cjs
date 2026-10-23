// Runs OpenCascade in a Node worker: its embind glue needs `new Function`,
// which the webview CSP rightly forbids, and a worker keeps tessellation off
// the extension host thread and cancellable.
const { parentPort, workerData } = require('node:worker_threads');

(async () => {
  try {
    const occt = await require(workerData.script)();
    const result = occt.ReadFile('step', workerData.bytes, workerData.params);
    if (!result?.success) throw new Error('OpenCascade could not read this STEP file');
    const meshes = result.meshes.map(mesh => ({
      position: Float32Array.from(mesh.attributes.position.array),
      index: Uint32Array.from(mesh.index.array),
    }));
    parentPort.postMessage({ meshes }, meshes.flatMap(mesh => [mesh.position.buffer, mesh.index.buffer]));
  } catch (error) {
    parentPort.postMessage({ error: error?.message ?? String(error) });
  }
})();
