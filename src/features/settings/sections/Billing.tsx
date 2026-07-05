import { useEffect, useState } from "react";
import { loadAIUsageStatus, type AIUsageStatus } from "@/services/ai/usage";
import { accountTypeLabel, canAccessPaidFeatures, loadAccountStatus, type AccountStatus } from "@/services/account";
import { SettingsSection } from "../ui";

export function Billing() {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [usage, setUsage] = useState<AIUsageStatus | null>(null);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const nextAccount = await loadAccountStatus();
      setAccount(nextAccount);
      if (canAccessPaidFeatures(nextAccount)) {
        setUsage(await loadAIUsageStatus());
      } else {
        setUsage(null);
      }
    } catch {
      // Subscription/usage status is informative; it must never take down
      // Settings if the network or backend returns an unexpected payload.
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);
  const subscription = account?.user?.subscription;
  const accessLabel = accountTypeLabel(account);
  const accessTone = account?.access === "active" || account?.access === "trialing" ? "text-[var(--ok)]" : account?.access === "past_due" || account?.access === "unpaid" || account?.access === "canceled" || account?.access === "expired" ? "text-[var(--danger)]" : "text-[var(--text-dim)]";
  const periodEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleString() : "—";

  return <div className="space-y-6">
    <SettingsSection title="Subscription" hint="Your tier is managed by your Zen account and refreshed from the server.">
      <div className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elev)] p-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">User type</div>
          <div className={`mt-1 text-xl font-semibold ${accessTone}`}>{loading && !account ? "Loading…" : accessLabel}</div>
        </div>
        <button className="zen-btn-ghost ml-auto" disabled={loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      <div className="grid gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elev)] p-4 text-sm sm:grid-cols-2">
        <Detail label="Authenticated" value={account?.authenticated ? "Yes" : "No"} />
        <Detail label="Subscription status" value={subscription?.status ?? "—"} />
        <Detail label="Plan" value={subscription?.plan ?? "—"} />
        <Detail label="Current period end" value={periodEnd} />
        <Detail label="Stripe customer" value={subscription?.stripeCustomerId ?? "—"} mono />
        <Detail label="Stripe subscription" value={subscription?.stripeSubscriptionId ?? "—"} mono />
      </div>
    </SettingsSection>

    <SettingsSection title="Monthly AI usage" hint={`Spend resets automatically at the start of each UTC month${usage ? ` · ${usage.period}` : ""}.`}>
      <UsageRow label={usage?.model ?? "DeepSeek"} spent={usage?.spentUsd ?? 0} budget={usage?.budgetUsd ?? 0} />
      <p className="text-[11px] text-[var(--text-dim)]">Free blocks AI. DeepSeek plans use V4 Flash with a $5 monthly budget. The legacy Claude plan name now means V4 Pro with a $25 monthly budget—Anthropic is not used.</p>
    </SettingsSection>
  </div>;
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="space-y-0.5">
    <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-dim)]">{label}</div>
    <div className={`${mono ? "font-mono text-[11px]" : "text-sm"} text-[var(--text)]`}>{value}</div>
  </div>;
}

function UsageRow({ label, spent, budget }: { label: string; spent: number; budget: number }) {
  const percent = budget ? Math.min(100, (spent / budget) * 100) : 0;
  return <div className="space-y-1.5">
    <div className="flex text-xs"><span className="font-medium text-[var(--text)]">{label}</span><span className="ml-auto text-[var(--text-dim)]">{budget ? `$${spent.toFixed(4)} / $${budget.toFixed(2)}` : "Not included"}</span></div>
    <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${percent}%` }} /></div>
  </div>;
}
