"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, PenLine } from "lucide-react";
import { useMarket } from "@/context/MarketContext";
import { marketRoutes } from "@/features/shared/navigation";
import { Badge, ResponsiveModal } from "@/features/shared/components/ui";
import { tapLight } from "@/utils/haptics";

// "Log a trade" — one chooser (AI screenshot vs manual) opened from the
// sidebar, the phone + tab and the dashboard. Mounted once in the root layout.

const LogTradeContext = createContext({ open: () => {} });

export function useLogTrade() {
  return useContext(LogTradeContext);
}

export function LogTradeProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const { currentMarket } = useMarket();
  const routes = marketRoutes(currentMarket);

  const open = useCallback(() => { tapLight(); setIsOpen(true); }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const value = useMemo(() => ({ open }), [open]);
  const go = (href) => { setIsOpen(false); router.push(href); };

  return (
    <LogTradeContext.Provider value={value}>
      {children}
      <ResponsiveModal open={isOpen} onClose={close} title="Log a trade" width={460}>
        <div className="ec-chooser">
          <button type="button" className="ec-chooser__opt ec-focusable" onClick={() => go(routes.uploadTrade)}>
            <span className="ec-chooser__icon is-accent"><Camera size={20} /></span>
            <span className="ec-chooser__text">
              <span className="ec-chooser__title">Upload screenshot</span>
              <span className="ec-chooser__sub">AI reads your broker screenshot and fills in the trade.</span>
            </span>
            <Badge tone="accent">Fastest</Badge>
          </button>
          <button type="button" className="ec-chooser__opt ec-focusable" onClick={() => go(routes.addTrade)}>
            <span className="ec-chooser__icon"><PenLine size={20} /></span>
            <span className="ec-chooser__text">
              <span className="ec-chooser__title">Enter manually</span>
              <span className="ec-chooser__sub">Type in the trade details yourself.</span>
            </span>
          </button>
        </div>
      </ResponsiveModal>
    </LogTradeContext.Provider>
  );
}
