"use client";

import { Share2 } from "lucide-react";
import { Button } from "@/features/shared/components/ui";

export default function ShareButton({ onClick, disabled }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} disabled={disabled} icon={<Share2 size={14} aria-hidden="true" />}>
      Share
    </Button>
  );
}
