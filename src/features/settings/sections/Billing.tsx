import { useEffect, useState } from "react";
import { loadAIUsageStatus, type AIUsageStatus } from "@/services/ai/usage";
import { accountTypeLabel, canAccessPaidFeatures, loadAccountStatus, type AccountStatus } from "@/services/account";
import { markTutorialItemDone } from "@/features/home/dashboardPrefs";
import { SettingsSection } from "../ui";

export function Billing() {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [usage, setUsage] = useState<AIUsageStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const nextAccount = await loadAccountStatus();
      setAccount(nextAccount);
      setUsage(canAccessPaidFeatures(nextAccount) ? await loadAIUsageStatus() : null);
    } catch (reason) {
      setUsage(null);
      setError((reason as Error).message || "Usage is temporarily unavailable");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    void refresh();
    // First Run Path: opening this section is "Review Plan & usage".
    markTutorialItemDone("plan-usage");
  }, []);
  const subscription = account?.user?.subscription;
  const paid = canAccessPaidFeatures(account);
  const spent = finite(usage?.spentUsd);
  const budget = finite(usage?.budgetUsd);
  const remaining = Math.max(0, budget - spent);
  const percent = budget ? Math.min(100, (spent / budget) * 100) : 0;
  const requests = (usage?.usage ?? []).reduce((sum, row) => sum + finite(row.requests), 0);
  const periodEnd = safeDate(subscription?.currentPeriodEnd);
  const trial = usage?.tier === "trial";
  const trialSpent = trial && budget > 0 && remaining < 0.005;

  return <div className="space-y-6">
    <SettingsSection title="Plan & usage" hint="Live account access and server-metered DeepSeek spend.">
      <div className="rounded-[14px] border border-[var(--border)] bg-[var(--bg-elev)] p-5">
        <div className="flex items-start gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--text-dim)]">Current plan</div>
            <div className="mt-1 text-2xl font-semibold capitalize text-[var(--text)]">{loading && !account ? "Loading…" : subscription?.plan ?? "Free"}</div>
            <div className={`mt-1 text-xs ${paid ? "text-[var(--ok)]" : "text-[var(--text-dim)]"}`}>{accountTypeLabel(account)}</div>
          </div>
          <button className="zen-btn-ghost ml-auto" disabled={loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh"}</button>
        </div>
        <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
          <Detail label="Model" value={usage?.model ?? "No AI"} />
          <Detail label="Billing status" value={subscription?.status ?? "None"} />
          <Detail label="Renews" value={periodEnd} />
        </div>
      </div>
      {error && <div className="rounded-[9px] border border-[var(--danger)] px-3 py-2 text-xs text-[var(--danger)]">{error}</div>}
    </SettingsSection>

    <SettingsSection title={trial ? "Trial usage" : "This month"} hint={trial ? `One-off trial budget${usage ? ` · ${usage.period}` : ""}` : `UTC calendar month${usage ? ` · ${usage.period}` : ""}`}>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Spent" value={budget ? money(spent, 4) : "—"} />
        <Metric label="Remaining" value={budget ? money(remaining, 2) : "—"} />
        <Metric label="Requests" value={String(requests)} />
      </div>
      <div className="mt-3 rounded-[12px] border border-[var(--border)] bg-[var(--bg)] p-4">
        <div className="flex items-center text-xs"><span className="font-medium text-[var(--text)]">{trial ? "Trial AI budget" : "Monthly AI budget"}</span><span className="ml-auto tabular-nums text-[var(--text-dim)]">{budget ? `${money(spent, 4)} of ${money(budget, 2)}` : "AI not included"}</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${percent}%` }} /></div>
        <div className="mt-1.5 text-right text-[11px] tabular-nums text-[var(--text-dim)]">{budget ? `${percent.toFixed(1)}% used` : "Free plan"}</div>
      </div>
      {trialSpent && <div className="mt-2 rounded-[10px] border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-3 py-2 text-xs text-[var(--text)]">
        Your trial budget is used up. Liked it? Get <b>Basic</b> (€5/month) on the Zen website to keep the AI going.
      </div>}
    </SettingsSection>

    <SettingsSection title="Model breakdown" hint="Settled provider usage for the current month.">
      {(usage?.usage.length ?? 0) > 0 ? <div className="overflow-hidden rounded-[10px] border border-[var(--border)]">
        {usage!.usage.map((row) => <div key={row.model} className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-xs last:border-0"><span className="font-medium text-[var(--text)]">{row.model}</span><span className="tabular-nums text-[var(--text-dim)]">{finite(row.requests)} calls</span><span className="w-20 text-right tabular-nums text-[var(--text)]">{money(finite(row.costUsd), 4)}</span></div>)}
      </div> : <div className="rounded-[10px] border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-dim)]">{paid ? "No settled AI requests this month." : "Subscribe to use Zen AI."}</div>}
      <p className="text-[11px] text-[var(--text-dim)]">Spend uses DeepSeek-reported cache-hit, cache-miss, and output tokens. Accepted calls without a final usage record retain their conservative pre-flight hold.</p>
    </SettingsSection>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-elev)] p-3"><div className="text-[10px] uppercase tracking-[0.18em] text-[var(--text-dim)]">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums text-[var(--text)]">{value}</div></div>;
}
function Detail({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-dim)]">{label}</div><div className="mt-0.5 truncate text-[var(--text)]" title={value}>{value}</div></div>;
}
function finite(value: unknown): number { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; }
function money(value: number, digits: number): string { return `$${finite(value).toFixed(digits)}`; }
function safeDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
