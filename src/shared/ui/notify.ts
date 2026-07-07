import { toast } from "sonner";

/**
 * Thin wrapper over the toast library so it stays swappable.
 * All transient feedback in the app goes through `notify`.
 */
export const notify = {
  success: (msg: string) => toast.success(msg),
  error: (msg: string) => toast.error(msg),
  info: (msg: string) => toast(msg),
  /** Toast with an inline Undo action, for destructive-but-reversible operations. */
  undo: (msg: string, onUndo: () => void) =>
    toast(msg, { action: { label: "Undo", onClick: onUndo }, duration: 8000 }),
  promise: toast.promise,
};
