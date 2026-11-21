"use client";
import { Button } from "@/components/ui/button";

export function FilterChips({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  options: { value: string; label: string }[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-1"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          disabled={disabled}
          size="sm"
          variant={value === option.value ? "secondary" : "ghost"}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className="h-8 text-xs"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
