/// <reference lib="webworker" />
/**
 * Embedding Web Worker — runs the on-device transformers.js model OFF the main
 * thread, so indexing a long PDF never freezes the UI. The main thread (vector.ts)
 * posts batches of text and gets back 384-d vectors; it drives batching + progress.
 *
 * Messages in:  { id: number, texts: string[] }
 * Messages out: { type: "status", status } | { type: "result", id, vectors } | { type: "error", id, message }
 */
import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers";
// Self-host the onnxruntime-web WASM via Vite (?url emits a bundled, served URL).
import ortWasm from "@xenova/transformers/dist/ort-wasm.wasm?url";
import ortWasmSimd from "@xenova/transformers/dist/ort-wasm-simd.wasm?url";
import ortWasmThreaded from "@xenova/transformers/dist/ort-wasm-threaded.wasm?url";
import ortWasmSimdThreaded from "@xenova/transformers/dist/ort-wasm-simd-threaded.wasm?url";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(env as any).allowLocalModels = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wasmCfg = (env as any).backends?.onnx?.wasm;
if (wasmCfg) {
  wasmCfg.numThreads = 1;
  wasmCfg.proxy = false;
  wasmCfg.wasmPaths = {
    "ort-wasm.wasm": ortWasm,
    "ort-wasm-simd.wasm": ortWasmSimd,
    "ort-wasm-threaded.wasm": ortWasmThreaded,
    "ort-wasm-simd-threaded.wasm": ortWasmSimdThreaded,
  };
}

let pipeP: Promise<FeatureExtractionPipeline> | null = null;
function getPipe(): Promise<FeatureExtractionPipeline> {
  if (!pipeP) {
    ctx.postMessage({ type: "status", status: "loading" });
    pipeP = (pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2") as Promise<FeatureExtractionPipeline>)
      .then((p) => {
        ctx.postMessage({ type: "status", status: "ready" });
        return p;
      })
      .catch((e) => {
        ctx.postMessage({ type: "status", status: "error" });
        pipeP = null; // don't cache the rejection — retry next time
        throw e;
      });
  }
  return pipeP;
}

/** Embed a batch; fall back to one-at-a-time if batched inference isn't supported. */
async function embed(texts: string[]): Promise<number[][]> {
  const pipe = await getPipe();
  const inputs = texts.map((t) => t.slice(0, 2000));
  try {
    const out = await pipe(inputs, { pooling: "mean", normalize: true });
    const data = out.data as Float32Array;
    const dim = out.dims[out.dims.length - 1];
    if (dim && data.length === texts.length * dim) {
      return texts.map((_, i) => Array.from(data.subarray(i * dim, (i + 1) * dim)));
    }
  } catch {
    /* fall through to sequential */
  }
  const vecs: number[][] = [];
  for (const t of inputs) {
    const out = await pipe(t, { pooling: "mean", normalize: true });
    vecs.push(Array.from(out.data as Float32Array));
  }
  return vecs;
}

// A single ONNX session can't run two inferences at once ("Session already
// started"), so serialize requests within this worker. Parallelism comes from
// running MULTIPLE workers (the pool in vector.ts), not concurrency inside one.
let chain: Promise<void> = Promise.resolve();
ctx.onmessage = (e: MessageEvent<{ id: number; texts: string[] }>) => {
  const { id, texts } = e.data;
  chain = chain.then(async () => {
    try {
      const vectors = await embed(texts);
      ctx.postMessage({ type: "result", id, vectors });
    } catch (err) {
      ctx.postMessage({ type: "error", id, message: (err as Error)?.message || String(err) });
    }
  });
};
