"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import BottomSheet from "../BottomSheet";
import FocusTrap from "../FocusTrap";
import useIsNarrow from "../../hooks/useIsNarrow";
import { registerDismissable } from "@/utils/backNavigation";
import Button from "./Button";

/**
 * One dialog API: a bottom sheet on phones (≤768px), a centred modal on
 * larger screens. Escape and the Android back gesture close both.
 */
export default function ResponsiveModal({ open, onClose, title, children, width = 520, sheetHeight = "auto" }) {
  const isNarrow = useIsNarrow(768);

  useEffect(() => {
    if (!open || isNarrow) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const unregister = registerDismissable(onClose);
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      if (typeof unregister === "function") unregister();
      body.style.overflow = prev;
    };
  }, [open, isNarrow, onClose]);

  if (!open) return null;

  const header = (
    <div className="ec-modal__head">
      <h2 className="ec-card__title">{title}</h2>
      <Button variant="ghost" size="sm" iconOnly aria-label="Close" icon={<X size={18} />} onClick={onClose} />
    </div>
  );

  if (isNarrow) {
    return (
      <BottomSheet onClose={onClose} label={title} height={sheetHeight} scrollable themed>
        <div className="ec-app" style={{ minHeight: 0, background: "transparent" }}>
          {header}
          <div className="ec-modal__body">{children}</div>
        </div>
      </BottomSheet>
    );
  }

  return (
    <div className="ec-modal-overlay" style={{ zIndex: 1100 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <FocusTrap>
        <div className="ec-modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
          {header}
          <div className="ec-modal__body">{children}</div>
        </div>
      </FocusTrap>
    </div>
  );
}
