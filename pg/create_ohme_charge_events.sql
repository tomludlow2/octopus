CREATE TABLE IF NOT EXISTS ohme_charge_events (
    id BIGSERIAL PRIMARY KEY,
    charge_started TIMESTAMPTZ NOT NULL,
    charge_ended TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
    kwh_estimated NUMERIC(12, 6) NOT NULL DEFAULT 0,
    cross_checked BOOLEAN NOT NULL DEFAULT FALSE,
    price NUMERIC(12, 6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (charge_started, charge_ended)
);

CREATE INDEX IF NOT EXISTS idx_ohme_charge_events_started ON ohme_charge_events (charge_started DESC);
