import { cn } from "@/lib/utils";

/**
 * The agent's model and — when its transcript states one — effort, beside the ctx gauge
 * (« Opus 5.5 · high »). Renders nothing without a model: no transcript read, no name invented.
 */
export function ModelTag({
  model,
  effort,
  lead,
  className,
}: {
  model?: string | null;
  effort?: string | null;
  /** Leading « · » for the footnote rows that chain their facts with one. */
  lead?: boolean;
  className?: string;
}) {
  if (!model) return null;
  return (
    <span className={cn("shrink-0", className)}>
      {lead && "· "}
      {model}
      {effort && ` · ${effort}`}
    </span>
  );
}
