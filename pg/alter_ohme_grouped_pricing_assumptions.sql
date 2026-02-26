ALTER TABLE ohme_charge_event_groups
    ADD COLUMN IF NOT EXISTS assumed_rate_p_per_kwh NUMERIC(12, 6) NOT NULL DEFAULT 7.0,
    ADD COLUMN IF NOT EXISTS assumed_cost_gbp NUMERIC(12, 6),
    ADD COLUMN IF NOT EXISTS billed_cost_gbp NUMERIC(12, 6),
    ADD COLUMN IF NOT EXISTS billed_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS billing_notes TEXT;

UPDATE ohme_charge_event_groups
SET assumed_cost_gbp = ROUND((energy_kwh * COALESCE(assumed_rate_p_per_kwh, 7.0) / 100.0)::numeric, 6)
WHERE assumed_cost_gbp IS NULL;
