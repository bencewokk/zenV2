import { useEffect, useState } from "react";
import { getIndexProgress, onIndexProgress, type IndexProgress } from "@/services/memory";

/** Live progress of an in-flight embedding/indexing pass (null when idle). */
export function useIndexProgress(): IndexProgress | null {
  const [p, setP] = useState<IndexProgress | null>(getIndexProgress());
  useEffect(() => onIndexProgress(setP), []);
  return p;
}
