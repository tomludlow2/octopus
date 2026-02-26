const axios = require('axios');
const fs = require('fs');
const path = require('path');

function loadHaConfig() {
    const configPath = path.join(__dirname, '../server/server_config.json');
    let fileConfig = {};

    if (fs.existsSync(configPath)) {
        fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    const haHost = process.env.HA_HOST || fileConfig.ha_ip || 'home.465streetlane.co.uk';
    const token = process.env.HA_TOKEN || fileConfig.token;

    if (!token) {
        throw new Error('Missing HA token. Set HA_TOKEN env var or provide server/server_config.json with token.');
    }

    return { haHost, token };
}

function toKw(value, unit) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;

    const normalizedUnit = String(unit || '').toLowerCase();
    if (normalizedUnit === 'w' || normalizedUnit === 'watt' || normalizedUnit === 'watts') {
        return numeric / 1000;
    }

    return numeric;
}

async function fetchEntityHistory({ haHost, token, entityId, days = 7 }) {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

    const url = `https://${haHost}/api/history/period/${startTime.toISOString()}`;

    const response = await axios.get(url, {
        params: {
            end_time: endTime.toISOString(),
            filter_entity_id: entityId,
            minimal_response: true,
            no_attributes: false
        },
        headers: {
            Authorization: `Bearer ${token}`
        },
        timeout: 30000
    });

    return {
        startTime,
        endTime,
        rows: response.data?.[0] || []
    };
}

function analyzePowerEvents(rows, thresholdKw = 0.1) {
    if (!rows.length) return { sessions: [], totalEstimatedKwh: 0 };

    const sorted = [...rows].sort((a, b) => new Date(a.last_changed) - new Date(b.last_changed));

    const sessions = [];
    let openSession = null;
    let totalEstimatedKwh = 0;

    for (let i = 0; i < sorted.length; i += 1) {
        const current = sorted[i];
        const currentTime = new Date(current.last_changed || current.last_updated || current.when);
        if (Number.isNaN(currentTime.getTime())) continue;

        const currentKw = toKw(current.state, current.attributes?.unit_of_measurement);
        const charging = currentKw >= thresholdKw;

        if (charging && !openSession) {
            openSession = {
                start: currentTime,
                end: null,
                duration_minutes: null,
                kwh_estimated: 0,
                peak_kw: currentKw
            };
        }

        if (openSession) {
            openSession.peak_kw = Math.max(openSession.peak_kw, currentKw);

            const next = sorted[i + 1];
            if (next) {
                const nextTime = new Date(next.last_changed || next.last_updated || next.when);
                if (!Number.isNaN(nextTime.getTime()) && nextTime > currentTime) {
                    const hours = (nextTime - currentTime) / (1000 * 60 * 60);
                    const sliceKwh = charging ? currentKw * hours : 0;
                    openSession.kwh_estimated += sliceKwh;
                    totalEstimatedKwh += sliceKwh;
                }
            }
        }

        if (!charging && openSession) {
            openSession.end = currentTime;
            openSession.duration_minutes = Math.round((openSession.end - openSession.start) / 60000);
            openSession.kwh_estimated = Number(openSession.kwh_estimated.toFixed(3));
            openSession.peak_kw = Number(openSession.peak_kw.toFixed(3));
            sessions.push(openSession);
            openSession = null;
        }
    }

    if (openSession) {
        openSession.duration_minutes = Math.round((Date.now() - openSession.start.getTime()) / 60000);
        openSession.kwh_estimated = Number(openSession.kwh_estimated.toFixed(3));
        openSession.peak_kw = Number(openSession.peak_kw.toFixed(3));
        openSession.note = 'Open session (no observed end state in requested history window)';
        sessions.push(openSession);
    }

    return {
        sessions,
        totalEstimatedKwh: Number(totalEstimatedKwh.toFixed(3))
    };
}

function splitIntoHalfHourBuckets(startTime, endTime) {
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return [];
    }

    const halfHourMs = 30 * 60 * 1000;
    const firstBoundary = Math.floor(startMs / halfHourMs) * halfHourMs;
    const buckets = [];

    for (let cursor = firstBoundary; cursor < endMs; cursor += halfHourMs) {
        const bucketStart = Math.max(cursor, startMs);
        const bucketEnd = Math.min(cursor + halfHourMs, endMs);
        if (bucketEnd <= bucketStart) continue;

        buckets.push({
            bucket_start: new Date(cursor),
            overlap_start: new Date(bucketStart),
            overlap_end: new Date(bucketEnd),
            overlap_minutes: (bucketEnd - bucketStart) / 60000
        });
    }

    return buckets;
}

function allocateKwhAcrossBuckets(startTime, endTime, totalKwh) {
    const buckets = splitIntoHalfHourBuckets(startTime, endTime);
    const durationMinutes = Math.max(0, (new Date(endTime) - new Date(startTime)) / 60000);

    if (durationMinutes <= 0) {
        return [];
    }

    return buckets.map((bucket) => ({
        interval_start: bucket.bucket_start,
        interval_end: new Date(bucket.bucket_start.getTime() + 30 * 60 * 1000),
        ohme_kwh: Number(((Number(totalKwh) || 0) * (bucket.overlap_minutes / durationMinutes)).toFixed(6))
    }));
}

module.exports = {
    loadHaConfig,
    fetchEntityHistory,
    analyzePowerEvents,
    splitIntoHalfHourBuckets,
    allocateKwhAcrossBuckets
};
