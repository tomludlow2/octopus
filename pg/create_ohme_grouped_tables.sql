CREATE TABLE IF NOT EXISTS ohme_charge_event_groups (
    id BIGSERIAL PRIMARY KEY,
    group_started TIMESTAMPTZ NOT NULL,
    group_ended TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
    energy_kwh NUMERIC(12, 6) NOT NULL DEFAULT 0,
    cross_checked BOOLEAN NOT NULL DEFAULT FALSE,
    vehicle TEXT NOT NULL DEFAULT 'unknown' CHECK (vehicle IN ('Audi', 'BMW', 'unknown')),
    grouping_version TEXT NOT NULL DEFAULT 'v1_gap15',
    merge_gap_minutes INTEGER NOT NULL DEFAULT 15,
    pricing_source TEXT,
    estimated_cost_gbp NUMERIC(12, 6),
    assumed_rate_p_per_kwh NUMERIC(12, 6) NOT NULL DEFAULT 7.0,
    assumed_cost_gbp NUMERIC(12, 6),
    billed_cost_gbp NUMERIC(12, 6),
    billed_checked_at TIMESTAMPTZ,
    billing_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_started, group_ended, grouping_version)
);

CREATE INDEX IF NOT EXISTS idx_ohme_group_started ON ohme_charge_event_groups (group_started DESC);
CREATE INDEX IF NOT EXISTS idx_ohme_group_vehicle_started ON ohme_charge_event_groups (vehicle, group_started DESC);

CREATE TABLE IF NOT EXISTS ohme_charge_event_group_members (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL REFERENCES ohme_charge_event_groups(id) ON DELETE CASCADE,
    raw_event_id BIGINT NOT NULL REFERENCES ohme_charge_events(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, raw_event_id),
    UNIQUE (raw_event_id)
);

CREATE INDEX IF NOT EXISTS idx_ohme_group_members_group ON ohme_charge_event_group_members (group_id);

CREATE TABLE IF NOT EXISTS ohme_charge_event_group_price_intervals (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL REFERENCES ohme_charge_event_groups(id) ON DELETE CASCADE,
    interval_start TIMESTAMPTZ NOT NULL,
    interval_end TIMESTAMPTZ NOT NULL,
    energy_kwh NUMERIC(12, 6) NOT NULL,
    unit_rate_p_per_kwh NUMERIC(12, 6),
    cost_gbp NUMERIC(12, 6) NOT NULL DEFAULT 0,
    tariff_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (group_id, interval_start)
);

CREATE INDEX IF NOT EXISTS idx_ohme_group_price_intervals_group ON ohme_charge_event_group_price_intervals (group_id, interval_start);
