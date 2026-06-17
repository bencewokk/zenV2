import { useEffect, useState } from "react";
import { getModelStatus, onModelStatus, type ModelStatus } from "@/services/memory";

/** Live status of the on-device embedding model. */
export function useMemoryStatus(): ModelStatus {
  const [status, setStatus] = useState<ModelStatus>(getModelStatus());
  useEffect(() => onModelStatus(setStatus), []);
  return status;
}
