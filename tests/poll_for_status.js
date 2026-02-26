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

function isChargingState(state) {
    if (!state) return false;
    const normalized = String(state).toLowerCase();
    const activeTerms = ['charging', 'in_progress', 'running', 'started'];
    const inactiveTerms = ['idle', 'complete', 'stopped', 'off', 'not_charging', 'unavailable', 'unknown'];

    if (inactiveTerms.some((term) => normalized.includes(term))) return false;
    return activeTerms.some((term) => normalized.includes(term));
}

function analyzeStatusEvents(historyRows) {
    if (!historyRows.length) return [];

    const sessions = [];
    let openSession = null;

    for (const row of historyRows) {
        const eventTime = new Date(row.last_changed || row.last_updated || row.when);
        if (Number.isNaN(eventTime.getTime())) continue;

        const charging = isChargingState(row.state);

        if (charging && !openSession) {
            openSession = {
                start: eventTime,
                start_state: row.state,
                end: null,
                end_state: null,
                duration_minutes: null
            };
            continue;
        }

        if (!charging && openSession) {
            openSession.end = eventTime;
            openSession.end_state = row.state;
            openSession.duration_minutes = Math.round((openSession.end - openSession.start) / 60000);
            sessions.push(openSession);
            openSession = null;
        }
    }

    if (openSession) {
        sessions.push({
            ...openSession,
            duration_minutes: Math.round((Date.now() - openSession.start.getTime()) / 60000),
            note: 'Open session (no observed end state in requested history window)'
        });
    }

    return sessions;
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

(async () => {
    const entityId = 'sensor.ohme_epod_status';

    try {
        const config = loadHaConfig();
        const { startTime, endTime, rows } = await fetchEntityHistory({ ...config, entityId, days: 7 });

        console.log(`Fetched ${rows.length} history rows for ${entityId}`);
        console.log(`Window: ${startTime.toISOString()} -> ${endTime.toISOString()}\n`);

        const sessions = analyzeStatusEvents(rows);

        if (!sessions.length) {
            console.log('No charge sessions inferred from status history.');
            return;
        }

        console.log('Inferred charge sessions (from status transitions):');
        sessions.forEach((session, index) => {
            console.log([
                `#${index + 1}`,
                `charge_started=${session.start.toISOString()}`,
                `charge_ended=${session.end ? session.end.toISOString() : 'ongoing'}`,
                `duration_minutes=${session.duration_minutes}`,
                `start_state=${session.start_state}`,
                `end_state=${session.end_state || 'n/a'}`,
                session.note ? `note=${session.note}` : null
            ].filter(Boolean).join(' | '));
        });
    } catch (error) {
        console.error('Failed to poll status history:', error.message);
        process.exitCode = 1;
    }
})();
