"use client";

import { forwardRef } from "react";
import { Spinner } from "./Spinner";

const cx = (...parts) => parts.filter(Boolean).join(" ");

/**
 * The one button. Styles live in app/design-system.css (.ec-btn).
 *
 * variant: "primary" | "secondary" | "ghost" | "danger"
 * size:    "sm" | "md" | "lg"
 * icon:    a lucide icon element shown before the label
 * iconOnly: square button — pass aria-label
 * as:      render as another element, e.g. Next's <Link>
 */
const Button = forwardRef(function Button(
  {
    variant = "primary",
    size = "md",
    block = false,
    iconOnly = false,
    loading = false,
    icon = null,
    as: Component = "button",
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const isButton = Component === "button";
  return (
    <Component
      ref={ref}
      type={isButton ? type || "button" : undefined}
      disabled={isButton ? disabled || loading : undefined}
      aria-busy={loading || undefined}
      className={cx(
        "ec-btn",
        `ec-btn--${variant}`,
        size !== "md" && `ec-btn--${size}`,
        block && "ec-btn--block",
        iconOnly && "ec-btn--icon",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="16px" /> : icon}
      {!iconOnly && children}
    </Component>
  );
});

export default Button;
