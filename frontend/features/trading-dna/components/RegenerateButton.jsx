"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/features/shared/components/ui";

export default function RegenerateButton({ onClick, isRegenerating, disabled, variant = "secondary", label = "Rebuild" }) {
  return (
    <Button
      variant={variant}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      loading={isRegenerating}
      icon={<RefreshCw size={14} aria-hidden="true" />}
    >
      {isRegenerating ? "Building…" : label}
    </Button>
  );
}
