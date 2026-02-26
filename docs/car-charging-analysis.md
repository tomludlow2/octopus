# Car Charging Ingestion and Pricing Analysis

This document records the code-level review of car charging ingestion and pricing flows.

- Home Assistant live ingestion: `server/socket_listener.js`
- Home Assistant historical backfill: `server/test_populate_old_audi_data.js`
- Event persistence: `lib/audiEventInsert.js`
- Session detection: `lib/audiDataProcessor.js`
- Charge event persistence: `lib/chargeEventInsert.js`
- Charge pricing: `lib/priceChargeEvent.js`
- Usage/tariff ingestion that feeds EV pricing input data: `lib/octopusImporter.js` + `lib/tariffRates.js`
- Presentation: `server/web_server.js` routes for charging events.

See PR summary for full details and caveats.
