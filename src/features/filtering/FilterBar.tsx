import { useMemo } from "react";
import { useNotes } from "@/features/notes/store";
import { facetValues, allTags, isFilterActive } from "@/features/filtering/filter";

export function FilterBar() {
  const notes = useNotes((s) => s.notes);
  const filter = useNotes((s) => s.filter);
  const setFilter = useNotes((s) => s.setFilter);
  const resetFilter = useNotes((s) => s.resetFilter);

  const list = useMemo(() => Object.values(notes), [notes]);
  const spaces = facetValues(list, "space");
  const subjects = facetValues(list, "subject");
  const units = facetValues(list, "unit");
  const tags = allTags(list);

  return (
    <div data-tour="filter-bar" className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-2 py-1.5">
      <input
        value={filter.query}
        onChange={(e) => setFilter({ query: e.target.value })}
        placeholder="Search…"
        className="min-w-[120px] flex-1 rounded bg-[var(--bg-elev)] px-2 py-1 text-sm outline-none placeholder:text-[var(--text-dim)]"
      />
      <Facet label="Space" value={filter.space} options={spaces} onChange={(v) => setFilter({ space: v })} />
      <Facet label="Subject" value={filter.subject} options={subjects} onChange={(v) => setFilter({ subject: v })} />
      <Facet label="Unit" value={filter.unit} options={units} onChange={(v) => setFilter({ unit: v })} />

      <button
        className={`rounded px-2 py-1 text-xs ${
          filter.inboxOnly ? "bg-[var(--accent-dim)] text-[var(--text)]" : "bg-[var(--bg-elev)] text-[var(--text-dim)]"
        }`}
        onClick={() => setFilter({ inboxOnly: !filter.inboxOnly })}
      >
        Inbox
      </button>

      {tags.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            const t = e.target.value;
            if (t && !filter.tags.includes(t)) setFilter({ tags: [...filter.tags, t] });
          }}
          className="rounded bg-[var(--bg-elev)] px-1 py-1 text-xs text-[var(--text-dim)] outline-none"
        >
          <option value="">+ tag</option>
          {tags.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      )}
      {filter.tags.map((t) => (
        <button
          key={t}
          className="rounded bg-[var(--accent-dim)] px-2 py-1 text-xs"
          onClick={() => setFilter({ tags: filter.tags.filter((x) => x !== t) })}
          title="Remove tag"
        >
          #{t} ✕
        </button>
      ))}

      {isFilterActive(filter) && (
        <button
          className="rounded px-2 py-1 text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
          onClick={resetFilter}
        >
          Clear
        </button>
      )}
    </div>
  );
}

function Facet(props: {
  label: string;
  value: string | null;
  options: string[];
  onChange: (v: string | null) => void;
}) {
  if (props.options.length === 0) return null;
  return (
    <select
      value={props.value ?? ""}
      onChange={(e) => props.onChange(e.target.value || null)}
      className={`rounded px-1 py-1 text-xs outline-none ${
        props.value ? "bg-[var(--accent-dim)] text-[var(--text)]" : "bg-[var(--bg-elev)] text-[var(--text-dim)]"
      }`}
    >
      <option value="">{props.label}</option>
      {props.options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
