import { LoaderCircle } from "lucide-react";
import type { ComponentPropsWithRef, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-stitch-500 text-cream-50 shadow-[0_6px_20px_-6px_rgb(204_58_47/0.7)] hover:bg-stitch-400 active:bg-stitch-600",
  secondary: "bg-cream-100 text-ink hover:bg-cream-50 active:bg-cream-200",
  ghost: "bg-transparent text-cream-200 ring-1 ring-inset ring-navy-600 hover:bg-navy-800 hover:text-cream-50",
};

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: Variant;
  loading?: boolean;
  icon?: ReactNode;
  size?: "md" | "lg";
}

export function Button({
  variant = "primary",
  loading = false,
  icon,
  size = "md",
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-tight",
        "transition-[background-color,transform,box-shadow,opacity] duration-150 ease-out",
        "hover:-translate-y-px active:translate-y-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream-100 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-950",
        "disabled:pointer-events-none disabled:opacity-50",
        size === "lg" ? "h-14 px-8 text-lg" : "h-11 px-5 text-[15px]",
        VARIANTS[variant],
        className,
      ].join(" ")}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
