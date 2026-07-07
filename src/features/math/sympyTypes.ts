import type { CheckResult, DerivationStep } from "@/features/math/cas";

export type SympyOp =
  | "status"
  | "simplify"
  | "evaluate"
  | "equivalent"
  | "checkAnswer"
  | "checkDerivation";

export interface SympyRequest {
  id: number;
  op: SympyOp;
  latex?: string;
  student?: string;
  target?: string;
}

export type SympyPayload =
  | { ok: true; value: string }
  | { ok: true; value: CheckResult }
  | { ok: true; value: { lines: string[]; steps: DerivationStep[] } }
  | { ok: false; error: string };

export type SympyResponse = SympyPayload & { id: number };

export type SympyStatus = "idle" | "loading" | "ready" | "error";
