const {
    loadHaConfig,
    fetchEntityHistory,
    analyzePowerEvents
} = require('../lib/ohmePowerUtils');

(async () => {
    const entityId = 'sensor.ohme_epod_power';

    try {
        const config = loadHaConfig();
        const { startTime, endTime, rows } = await fetchEntityHistory({ ...config, entityId, days: 7 });
        const { sessions, totalEstimatedKwh } = analyzePowerEvents(rows);

        console.log(`Fetched ${rows.length} history rows for ${entityId}`);
        console.log(`Window: ${startTime.toISOString()} -> ${endTime.toISOString()}`);
        console.log(`Total estimated kWh from power integration (7d): ${totalEstimatedKwh}\n`);

        if (!sessions.length) {
            console.log('No charge sessions inferred from power history.');
            return;
        }

        console.log('Inferred charge sessions (from power threshold):');
        sessions.forEach((session, index) => {
            console.log([
                `#${index + 1}`,
                `charge_started=${session.start.toISOString()}`,
                `charge_ended=${session.end ? session.end.toISOString() : 'ongoing'}`,
                `duration_minutes=${session.duration_minutes}`,
                `kwh_estimated=${session.kwh_estimated}`,
                `peak_kw=${session.peak_kw}`,
                session.note ? `note=${session.note}` : null
            ].filter(Boolean).join(' | '));
        });
    } catch (error) {
        console.error('Failed to poll power history:', error.message);
        process.exitCode = 1;
    }
})();
