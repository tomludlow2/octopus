const axios = require('axios');
const fs = require('fs');
const path = require('path');

function loadHaConfig() {
    const configPath = path.join(__dirname, '../server_config.json');
    let fileConfig = {};

    if (fs.existsSync(configPath)) {
        fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }

    const haHost = process.env.HA_HOST || fileConfig.ha_ip || 'home.465streetlane.co.uk';
    const token = process.env.HA_TOKEN || fileConfig.token;

    if (!token) {
        throw new Error('Missing HA token. Set HA_TOKEN env var or provide server_config.json with token.');
    }

    return { haHost, token };
}

async function fetchEntityHistory({ haHost, token, entityId, days = 7 }) {
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

    const url = `https://${haHost}/api/history/period/${startTime.toISOString()}`;

    const response = await axios.get(url, {
        params: {
            end_time: endTime.toISOString(),
            filter_entity_id: entityId,
            minimal_response: false,
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

function normalizeRows(rows) {
    return rows.map((row) => {
        const eventTime = row.last_changed || row.last_updated || row.when;
        const value = Number(row.state);
        return {
            timestamp: eventTime,
            state_raw: row.state,
            value_numeric: Number.isFinite(value) ? value : null,
            unit_of_measurement: row.attributes?.unit_of_measurement || null,
            attributes: row.attributes || {}
        };
    });
}

(async () => {
    const entityId = 'sensor.octopus_energy_electricity_19p0308490_2343265534613_current_accumulative_consumption';

    try {
        const config = loadHaConfig();
        const { startTime, endTime, rows } = await fetchEntityHistory({ ...config, entityId, days: 7 });

        const output = {
            metadata: {
                entity_id: entityId,
                period_start: startTime.toISOString(),
                period_end: endTime.toISOString(),
                sample_count: rows.length,
                generated_at: new Date().toISOString(),
                note: 'Normalized HA history export suitable for downstream LLM analysis.'
            },
            samples: normalizeRows(rows)
        };

        const outputDir = path.join(__dirname, '../reports');
        fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, 'octopus_accumulative_consumption_last_7_days.json');
        fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

        console.log(`Fetched ${rows.length} rows for ${entityId}`);
        console.log(`Saved JSON output to: ${outputPath}`);
    } catch (error) {
        console.error('Failed to export accumulative consumption history:', error.message);
        process.exitCode = 1;
    }
})();
