"use client";

const cx = (...parts) => parts.filter(Boolean).join(" ");

/**
 * Surface container. `padded` (default) applies the standard inset;
 * `onClick` makes the whole card interactive and keyboard reachable.
 */
export default function Card({ padded = true, onClick, className, children, as: Component = "section", ...rest }) {
  const interactive = typeof onClick === "function";
  return (
    <Component
      className={cx("ec-card", padded && "ec-card--pad", interactive && "ec-card--interactive ec-focusable", className)}
      onClick={onClick}
      role={interactive && Component !== "button" ? "button" : undefined}
      tabIndex={interactive && Component !== "button" ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(e);
              }
            }
          : undefined
      }
      {...rest}
    >
      {children}
    </Component>
  );
}

/** Title row: title + optional subtitle on the left, `action` on the right. */
export function CardHeader({ title, subtitle, action, as: Heading = "h2" }) {
  return (
    <div className="ec-card__head">
      <div>
        <Heading className="ec-card__title">{title}</Heading>
        {subtitle && <p className="ec-card__sub">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
