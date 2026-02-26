ALTER TABLE ohme_charge_events
    ADD COLUMN IF NOT EXISTS vehicle TEXT NOT NULL DEFAULT 'unknown'
    CHECK (vehicle IN ('Audi', 'BMW', 'unknown'));

CREATE INDEX IF NOT EXISTS idx_ohme_charge_events_vehicle
    ON ohme_charge_events (vehicle, charge_started DESC);
