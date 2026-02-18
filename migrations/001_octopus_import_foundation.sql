CREATE TABLE IF NOT EXISTS octopus_rate_intervals (
    id BIGSERIAL PRIMARY KEY,
    fuel TEXT NOT NULL CHECK (fuel IN ('electric', 'gas')),
    tariff_code TEXT NOT NULL,
    interval_start TIMESTAMPTZ NOT NULL,
    interval_end TIMESTAMPTZ NOT NULL,
    value_inc_vat NUMERIC(10, 6),
    value_exc_vat NUMERIC(10, 6),
    payment_method TEXT,
    source_updated_at TIMESTAMPTZ,
    source_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fuel, tariff_code, interval_start)
);

CREATE INDEX IF NOT EXISTS idx_octopus_rate_intervals_lookup
    ON octopus_rate_intervals (fuel, interval_start);

CREATE TABLE IF NOT EXISTS octopus_rate_change_audit (
    id BIGSERIAL PRIMARY KEY,
    fuel TEXT NOT NULL CHECK (fuel IN ('electric', 'gas')),
    tariff_code TEXT,
    interval_start TIMESTAMPTZ NOT NULL,
    previous_value_inc_vat NUMERIC(10, 6),
    new_value_inc_vat NUMERIC(10, 6),
    previous_value_exc_vat NUMERIC(10, 6),
    new_value_exc_vat NUMERIC(10, 6),
    previous_source_updated_at TIMESTAMPTZ,
    new_source_updated_at TIMESTAMPTZ,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_electric_consumption_start_time ON electric_consumption (start_time);
CREATE INDEX IF NOT EXISTS idx_gas_consumption_start_time ON gas_consumption (start_time);
