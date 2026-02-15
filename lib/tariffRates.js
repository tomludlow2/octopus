const axios = require('axios');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));

function getProductCodeFromTariffCode(tariffCode) {
    // Example tariff code: E-1R-INTELLI-VAR-24-10-29-M
    // Product code should be: INTELLI-VAR-24-10-29
    if (!tariffCode || typeof tariffCode !== 'string') {
        throw new Error('Invalid tariff code.');
    }

    const parts = tariffCode.split('-');

    if (parts.length < 4) {
        throw new Error(`Unable to parse product code from tariff code: ${tariffCode}`);
    }

    return parts.slice(2, -1).join('-');
}


function splitIntoDateWindows(startIso, endIso, windowDays = 30) {
    const windows = [];
    let cursor = new Date(startIso);
    const end = new Date(endIso);

    while (cursor < end) {
        const next = new Date(cursor);
        next.setUTCDate(next.getUTCDate() + windowDays);

        windows.push({
            start: cursor.toISOString(),
            end: (next < end ? next : end).toISOString()
        });

        cursor = next;
    }

    return windows;
}

function overlapPeriod(startA, endA, startB, endB) {
    const start = new Date(Math.max(new Date(startA).getTime(), new Date(startB).getTime())).toISOString();
    const end = new Date(Math.min(new Date(endA).getTime(), new Date(endB).getTime())).toISOString();

    if (new Date(start).getTime() >= new Date(end).getTime()) {
        return null;
    }

    return { start, end };
}

async function fetchAllPaginatedResults(initialUrl) {
    const allResults = [];
    let nextUrl = initialUrl;

    while (nextUrl) {
        const response = await axios.get(nextUrl, {
            auth: {
                username: config.api_key,
                password: ''
            }
        });

        const pageResults = response?.data?.results || [];
        allResults.push(...pageResults);
        nextUrl = response?.data?.next;
    }

    return allResults;
}

async function getAccountData() {
    const url = `https://api.octopus.energy/v1/accounts/${config.account_num}/`;
    const response = await axios.get(url, {
        auth: {
            username: config.api_key,
            password: ''
        }
    });

    return response.data;
}

function pickProperty(accountData) {
    if (!accountData?.properties?.length) {
        throw new Error('No properties found in account data.');
    }

    const activeProperty = accountData.properties.find((property) => property.moved_out_at === null);
    return activeProperty || accountData.properties[0];
}

function getAgreementsForMeter(property, energyType) {
    const isElectric = energyType === 'electric';
    const meterPoints = isElectric
        ? (property.electricity_meter_points || [])
        : (property.gas_meter_points || []);

    if (meterPoints.length === 0) {
        return [];
    }

    const configuredId = isElectric ? config.e_mpan : config.g_mprn;
    const idKey = isElectric ? 'mpan' : 'mprn';

    const selectedMeterPoint = meterPoints.find((point) => String(point[idKey]) === String(configuredId)) || meterPoints[0];
    return selectedMeterPoint.agreements || [];
}

function getTariffsForPeriod(agreements, startIso, endIso) {
    return agreements
        .map((agreement) => {
            const validFrom = agreement.valid_from;
            const validTo = agreement.valid_to || endIso;
            const overlap = overlapPeriod(validFrom, validTo, startIso, endIso);

            if (!overlap) {
                return null;
            }

            return {
                tariff_code: agreement.tariff_code,
                period_from: overlap.start,
                period_to: overlap.end
            };
        })
        .filter(Boolean);
}

function uniqueRates(rates) {
    const seen = new Set();

    return rates.filter((rate) => {
        const key = [
            rate.valid_from,
            rate.valid_to,
            rate.value_inc_vat,
            rate.value_exc_vat,
            rate.payment_method || ''
        ].join('|');

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

async function fetchRatesForTariff(energyType, tariffCode, startIso, endIso) {
    const basePath = energyType === 'electric' ? 'electricity-tariffs' : 'gas-tariffs';
    const productCode = getProductCodeFromTariffCode(tariffCode);
    const windows = splitIntoDateWindows(startIso, endIso, 30);
    const allRates = [];

    for (const window of windows) {
        const url = `https://api.octopus.energy/v1/products/${productCode}/${basePath}/${tariffCode}/standard-unit-rates/?period_from=${window.start}&period_to=${window.end}`;
        const chunk = await fetchAllPaginatedResults(url);
        allRates.push(...chunk);
    }

    return allRates;
}

async function getTariffPeriodsForFuel(energyType, startIso, endIso) {
    const accountData = await getAccountData();
    const property = pickProperty(accountData);
    const agreements = getAgreementsForMeter(property, energyType);

    if (agreements.length === 0) {
        throw new Error(`No ${energyType} agreements found for account property.`);
    }

    return getTariffsForPeriod(agreements, startIso, endIso);
}

async function getUnitRatesForPeriod(energyType, startIso, endIso) {
    const tariffPeriods = await getTariffPeriodsForFuel(energyType, startIso, endIso);

    if (tariffPeriods.length === 0) {
        return [];
    }

    const rateSets = await Promise.all(
        tariffPeriods.map(async (item) => {
            const rates = await fetchRatesForTariff(energyType, item.tariff_code, item.period_from, item.period_to);
            return rates.map((rate) => ({ ...rate, tariff_code: item.tariff_code }));
        })
    );

    const mergedRates = uniqueRates(rateSets.flat());

    if (typeof config.direct_debit !== 'boolean') {
        return mergedRates;
    }

    const expectedPaymentMethod = config.direct_debit ? 'DIRECT_DEBIT' : 'NON_DIRECT_DEBIT';
    const filteredRates = mergedRates.filter((rate) => rate.payment_method === expectedPaymentMethod);

    return filteredRates.length > 0 ? filteredRates : mergedRates;
}

async function getElectricUnitRatesForPeriod(startIso, endIso) {
    return getUnitRatesForPeriod('electric', startIso, endIso);
}

async function getGasUnitRatesForPeriod(startIso, endIso) {
    return getUnitRatesForPeriod('gas', startIso, endIso);
}

module.exports = {
    getElectricUnitRatesForPeriod,
    getGasUnitRatesForPeriod,
    getProductCodeFromTariffCode,
    splitIntoDateWindows,
    getTariffPeriodsForFuel
};
