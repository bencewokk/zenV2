import type { CheckResult, DerivationStep } from "@/features/math/cas";
import type { SympyRequest, SympyResponse, SympyStatus } from "@/features/math/sympyTypes";

type Listener = (status: SympyStatus) => void;

let worker: Worker | null = null;
let nextId = 1;
let status: SympyStatus = "idle";
const listeners = new Set<Listener>();
const pending = new Map<
  number,
  {
    resolve: (response: SympyResponse) => void;
    reject: (error: Error) => void;
  }
>();

function setStatus(next: SympyStatus): void {
  if (status === next) return;
  status = next;
  listeners.forEach((fn) => fn(status));
}

function ensureWorker(): Worker {
  if (worker) return worker;
  setStatus("loading");
  worker = new Worker(new URL("./sympyWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<SympyResponse>) => {
    const response = event.data;
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.ok) setStatus("ready");
    entry.resolve(response);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "SymPy worker crashed");
    setStatus("error");
    pending.forEach((entry) => entry.reject(error));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function request(input: Omit<SympyRequest, "id">): Promise<SympyResponse> {
  const id = nextId++;
  const w = ensureWorker();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, ...input });
  });
}

export function getSympyStatus(): SympyStatus {
  return status;
}

export function onSympyStatus(fn: Listener): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export async function warmSympy(): Promise<void> {
  const response = await request({ op: "status" });
  if (!response.ok) throw new Error(response.error);
}

export async function sympySimplify(latex: string): Promise<string> {
  const response = await request({ op: "simplify", latex });
  if (!response.ok) throw new Error(response.error);
  return String(response.value);
}

export async function sympyEvaluate(latex: string): Promise<string> {
  const response = await request({ op: "evaluate", latex });
  if (!response.ok) throw new Error(response.error);
  return String(response.value);
}

export async function sympyEquivalent(student: string, target: string): Promise<boolean> {
  const response = await request({ op: "equivalent", student, target });
  if (!response.ok) throw new Error(response.error);
  return response.value === "equivalent";
}

export async function sympyCheckAnswer(student: string, target: string): Promise<CheckResult> {
  const response = await request({ op: "checkAnswer", student, target });
  if (!response.ok) throw new Error(response.error);
  return response.value as CheckResult;
}

export async function sympyCheckDerivation(latex: string): Promise<{ lines: string[]; steps: DerivationStep[] }> {
  const response = await request({ op: "checkDerivation", latex });
  if (!response.ok) throw new Error(response.error);
  return response.value as { lines: string[]; steps: DerivationStep[] };
}

