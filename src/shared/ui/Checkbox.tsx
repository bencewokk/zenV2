import type { ComponentProps, ReactNode } from "react";
import { Checkbox as UUICheckbox } from "@/shared/ui/uui/base/checkbox/checkbox";

type UUIProps = ComponentProps<typeof UUICheckbox>;

export interface CheckboxProps
  extends Omit<UUIProps, "isSelected" | "onChange" | "label"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
}

export function Checkbox({
  checked,
  onCheckedChange,
  ...props
}: CheckboxProps) {
  return (
    <UUICheckbox
      isSelected={checked}
      onChange={onCheckedChange}
      {...props}
    />
  );
}
