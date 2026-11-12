"use client";

import { cloneElement, forwardRef, isValidElement, useId } from "react";

const cx = (...parts) => parts.filter(Boolean).join(" ");

/**
 * Label + control + hint/error, wired for accessibility. The single child
 * control receives id, aria-invalid and aria-describedby automatically:
 *
 *   <Field label="Entry price" required error={errors.entry}>
 *     <Input inputMode="decimal" mono value={…} onChange={…} />
 *   </Field>
 */
export default function Field({ label, hint, error, required = false, children, className }) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        required: children.props.required ?? required,
      })
    : children;
  return (
    <div className={cx("ec-field", className)}>
      {label && (
        <label className="ec-field__label" htmlFor={isValidElement(children) ? children.props.id ?? id : undefined}>
          {label}
          {!required && <span className="ec-field__req"> · optional</span>}
        </label>
      )}
      {control}
      {error ? (
        <span id={`${id}-error`} className="ec-field__error" role="alert">
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className="ec-field__hint">
            {hint}
          </span>
        )
      )}
    </div>
  );
}

export const Input = forwardRef(function Input({ mono = false, className, ...rest }, ref) {
  return <input ref={ref} className={cx("ec-input", mono && "ec-input--mono", className)} {...rest} />;
});

export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx("ec-input", className)} {...rest}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx("ec-input", className)} {...rest} />;
});
