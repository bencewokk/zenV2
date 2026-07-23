import type { ReactNode } from "react";
import { Button } from "@/shared/ui/Button";

/** A titled group of related settings. */
export function SettingsSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-elev)] p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-[var(--text-dim)]">{hint}</p>}
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

/** A labelled form row. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--text-dim)]">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--text-dim)]">{hint}</span>}
    </label>
  );
}

/** Right-aligned Save button with optional extra controls on the left. */
export function SaveBar({ onSave, children }: { onSave: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      {children}
      <Button className="ml-auto" onClick={onSave}>Save</Button>
    </div>
  );
}
