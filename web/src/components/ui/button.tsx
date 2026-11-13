import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Square (the 2 px radius), no shadow, no line: a button is a raised tone. At least 30 px tall on
  // a desktop, 44 px on a phone (the touch floor).
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] select-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        // The primary action of a panel: the action colour, filled. One per panel.
        brand: "bg-brand text-brand-foreground hover:bg-brand/90",
        // The gesture that concludes (merge, validate): green, the colour of « done ».
        success: "bg-status-done text-status-chip-foreground hover:bg-status-done/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // The system's secondary button. `outline` is kept as a name for its callers; it is the same
        // raised surface now — Sémaphore draws no lines.
        outline: "bg-secondary text-secondary-foreground hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        // Navigation inside a sentence only — never an action (see action-buttons.test).
        link: "text-foreground underline underline-offset-4 decoration-muted-foreground hover:decoration-foreground",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3 max-sm:min-h-11",
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5 max-sm:min-h-11",
        lg: "h-11 px-6 has-[>svg]:px-4 text-base",
        icon: "size-9 max-sm:size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
