import { parentPort, workerData } from 'node:worker_threads';
import { createWorker, OEM } from 'tesseract.js';
// Only trusted application code executes in this thread. Image bytes and paths
// are data; the caller has already checked bounds and local language files.
const input = workerData as {
    bytes: Uint8Array;
    language: string;
    dataDir: string;
    gzip: boolean;
};
let engine: Awaited<ReturnType<typeof createWorker>> | undefined;
try {
    engine = await createWorker(input.language, OEM.LSTM_ONLY, {
        langPath: input.dataDir, gzip: input.gzip, cacheMethod: 'none',
        logger: () => { }, errorHandler: () => { },
    });
    const result = await engine.recognize(Buffer.from(input.bytes));
    parentPort!.postMessage({ text: result.data.text });
}
catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : 'OCR failed' });
}
finally {
    await engine?.terminate();
}
