"use client";

import { useEffect, useState } from "react";
import { Button, Field, Input } from "@/features/shared/components/ui";
import { updateRiskLimits } from "@/services/riskLimitsApi";
import { getUserMessage } from "@/utils/userMessage";
import {
  MARKET_META, parseLossLimitInput, parseTradeLimitInput, toInputValue,
} from "@/features/settings/utils/riskLimits";

/**
 * Daily loss limit + max trades per day for one market. Used by
 * Settings → Trading limits and the first-time prompt on trade screens.
 *
 * onSaved(updatedAllMarkets) runs after a successful save.
 * secondaryAction: optional extra button (e.g. "Not now") rendered beside Save.
 */
export default function RiskLimitsForm({ market, initial, onSaved, secondaryAction = null, saveLabel = "Save limits" }) {
  const meta = MARKET_META[market] || MARKET_META.Forex;
  const [loss, setLoss] = useState(toInputValue(initial?.dailyLossLimit));
  const [trades, setTrades] = useState(toInputValue(initial?.maxTradesPerDay));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset when the stored values change (e.g. after the first load).
  useEffect(() => {
    setLoss(toInputValue(initial?.dailyLossLimit));
    setTrades(toInputValue(initial?.maxTradesPerDay));
  }, [initial?.dailyLossLimit, initial?.maxTradesPerDay]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (saving) return;
    const l = parseLossLimitInput(loss);
    const t = parseTradeLimitInput(trades);
    const nextErrors = { loss: l.error, trades: t.error };
    setErrors(nextErrors);
    if (l.error || t.error) return;

    setSaving(true);
    setSaved(false);
    try {
      const updated = await updateRiskLimits({ market, dailyLossLimit: l.value, maxTradesPerDay: t.value });
      setSaved(true);
      onSaved?.(updated);
    } catch (err) {
      setErrors({ form: getUserMessage(err, "Couldn't save your limits. Check your connection and try again.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="ec-rl-form">
      <div className="ec-rl-form__grid">
        <Field
          label={`Daily loss limit (${meta.currency})`}
          hint={`Alerts at 80% and 100%. e.g. ${meta.currency}${meta.example}`}
          error={errors.loss}
        >
          <Input
            mono
            inputMode="decimal"
            autoComplete="off"
            placeholder="Off"
            value={loss}
            onChange={(e) => { setLoss(e.target.value); setSaved(false); }}
          />
        </Field>
        <Field label="Max trades per day" hint="Alert when you reach it" error={errors.trades}>
          <Input
            mono
            inputMode="numeric"
            autoComplete="off"
            placeholder="Off"
            value={trades}
            onChange={(e) => { setTrades(e.target.value); setSaved(false); }}
          />
        </Field>
      </div>
      {errors.form && <p className="ec-field__error" role="alert" style={{ margin: "8px 0 0" }}>{errors.form}</p>}
      <div className="ec-rl-form__actions">
        <Button type="submit" size="sm" loading={saving}>{saveLabel}</Button>
        {secondaryAction}
        {saved && !saving && <span className="ec-rl-form__saved" role="status">Saved</span>}
      </div>
    </form>
  );
}
