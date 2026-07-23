import { Button as AriaButton } from "react-aria-components";
import { Dropdown as UUIDropdown } from "@/shared/ui/uui/base/dropdown/dropdown";

export interface DropdownOption {
  value: string;
  label: string;
}

/**
 * Compact single-value menu backed by Untitled UI.
 *
 * This keeps Zen's original value/options API while React Aria owns focus,
 * keyboard navigation, selection, dismissal, and screen-reader semantics.
 */
export function Dropdown({
  value,
  options,
  onChange,
  className = "",
  title,
  align = "left",
}: {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  className?: string;
  title?: string;
  align?: "left" | "right";
}) {
  const current = options.find((option) => option.value === value);

  return (
    <UUIDropdown.Root>
      <AriaButton
        aria-label={title ?? current?.label ?? "Choose an option"}
        className={`zen-pressable flex w-full min-w-0 items-center gap-1 truncate rounded bg-transparent py-0.5 text-left outline-none hover:text-[var(--text)] ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">
          {current?.label ?? value}
        </span>
        <span aria-hidden="true" className="shrink-0 text-[var(--text-dim)]">
          ⌄
        </span>
      </AriaButton>
      <UUIDropdown.Popover
        placement={align === "right" ? "bottom right" : "bottom left"}
        className="min-w-[180px] max-w-[280px]"
      >
        <UUIDropdown.Menu
          selectionMode="single"
          selectedKeys={new Set([value])}
          onAction={(key) => onChange(String(key))}
          items={options}
        >
          {(option) => (
            <UUIDropdown.Item id={option.value} label={option.label} />
          )}
        </UUIDropdown.Menu>
      </UUIDropdown.Popover>
    </UUIDropdown.Root>
  );
}
