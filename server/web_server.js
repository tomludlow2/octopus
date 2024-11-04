const express = require('express');
const fs = require('fs');
const { Client } = require('pg');
const path = require('path');

const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

const app = express();
const port = 52529;

// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Serve the electric consumption page
app.get('/view_electric', async (req, res) => {
    const { startDate, endDate } = req.query;

    const client = new Client(dbConfig);
    let query = 'SELECT consumption_kwh, price_pence, start_time, end_time FROM electric_consumption';
    let queryParams = [];

    if (startDate && endDate) {
        query += ' WHERE start_time >= $1 AND end_time <= $2';
        queryParams.push(startDate, endDate);
    }

    query += ' ORDER BY start_time';

    try {
        await client.connect();
        const result = await client.query(query, queryParams);

        let html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Electric Consumption Data</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            <link rel="stylesheet" href="https://unpkg.com/bootstrap-table@1.21.1/dist/bootstrap-table.min.css">
        </head>
        <body>
            <div class="container mt-4">
                <h1>Electric Consumption Data</h1>

                <form method="GET" class="mb-4">
                    <div class="row">
                        <div class="col-md-5">
                            <input type="datetime-local" name="startDate" class="form-control" value="${startDate || ''}" required>
                        </div>
                        <div class="col-md-5">
                            <input type="datetime-local" name="endDate" class="form-control" value="${endDate || ''}" required>
                        </div>
                        <div class="col-md-2">
                            <button type="submit" class="btn btn-primary">Filter</button>
                        </div>
                    </div>
                </form>

                <button id="exportBtn" class="btn btn-primary mb-3">Export to CSV</button>
                <table 
                    id="electricTable" 
                    class="table table-bordered table-hover"
                    data-toggle="table" 
                    data-search="true" 
                    data-pagination="true"
                    data-show-columns="true"
                    data-page-size="10" 
                    data-page-list="[5, 10, 20, 50]"
                    data-toolbar="#toolbar">
                    <thead>
                        <tr>
                            <th data-field="consumption_kwh" data-sortable="true">Consumption (kWh)</th>
                            <th data-field="price_pence" data-sortable="true">Price (pence)</th>
                            <th data-field="start_time" data-sortable="true">Start Time</th>
                            <th data-field="end_time" data-sortable="true">End Time</th>
                        </tr>
                    </thead>
                    <tbody>`;

        result.rows.forEach(row => {
            html += `
            <tr>
                <td>${parseFloat(row.consumption_kwh).toFixed(3)}</td>
                <td>${parseFloat(row.price_pence).toFixed(2)}</td>
                <td>${new Date(row.start_time).toLocaleString()}</td>
                <td>${new Date(row.end_time).toLocaleString()}</td>
            </tr>`;
        });

        html += `
                    </tbody>
                </table>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
            <script src="https://unpkg.com/bootstrap-table@1.21.1/dist/bootstrap-table.min.js"></script>
            <script src="https://unpkg.com/bootstrap-table@1.21.1/dist/extensions/export/bootstrap-table-export.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.16.9/xlsx.full.min.js"></script>
            <script>
                document.getElementById('exportBtn').addEventListener('click', function() {
                    const table = document.getElementById('electricTable');
                    const wb = XLSX.utils.table_to_book(table, { sheet: 'Electric Consumption' });
                    XLSX.writeFile(wb, 'electric_consumption.xlsx');
                });
            </script>
        </body>
        </html>`;

        res.send(html);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    } finally {
        await client.end();
    }
});

// Serve the gas consumption page
app.get('/view_gas', async (req, res) => {
    const { startDate, endDate } = req.query;

    const client = new Client(dbConfig);
    let query = 'SELECT consumption_kwh, price_pence, start_time, end_time FROM gas_consumption';
    let queryParams = [];

    if (startDate && endDate) {
        query += ' WHERE start_time >= $1 AND end_time <= $2';
        queryParams.push(startDate, endDate);
    }

    query += ' ORDER BY start_time';

    try {
        await client.connect();
        const result = await client.query(query, queryParams);

        let html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Gas Consumption Data</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            <link rel="stylesheet" href="https://unpkg.com/bootstrap-table@1.21.1/dist/bootstrap-table.min.css">
        </head>
        <body>
            <div class="container mt-4">
                <h1>Gas Consumption Data</h1>

                <form method="GET" class="mb-4">
                    <div class="row">
                        <div class="col-md-5">
                            <input type="datetime-local" name="startDate" class="form-control" value="${startDate || ''}" required>
                        </div>
                        <div class="col-md-5">
                            <input type="datetime-local" name="endDate" class="form-control" value="${endDate || ''}" required>
                        </div>
                        <div class="col-md-2">
                            <button type="submit" class="btn btn-primary">Filter</button>
                        </div>
                    </div>
                </form>

                <button id="exportBtn" class="btn btn-primary mb-3">Export to CSV</button>
                <table 
                    id="gasTable" 
                    class="table table-bordered table-hover"
                    data-toggle="table" 
                    data-search="true" 
                    data-pagination="true"
                    data-show-columns="true"
                    data-page-size="10" 
                    data-page-list="[5, 10, 20, 50]"
                    data-toolbar="#toolbar">
                    <thead>
                        <tr>
                            <th data-field="consumption_kwh" data-sortable="true">Consumption (kWh)</th>
                            <th data-field="price_pence" data-sortable="true">Price (pence)</th>
                            <th data-field="start_time" data-sortable="true">Start Time</th>
                            <th data-field="end_time" data-sortable="true">End Time</th>
                        </tr>
                    </thead>
                    <tbody>`;

        result.rows.forEach(row => {
            html += `
            <tr>
                <td>${parseFloat(row.consumption_kwh).toFixed(3)}</td>
                <td>${parseFloat(row.price_pence).toFixed(2)}</td>
                <td>${new Date(row.start_time).toLocaleString()}</td>
                <td>${new Date(row.end_time).toLocaleString()}</td>
            </tr>`;
        });

        html += `
                    </tbody>
                </table>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
            <script src="https://unpkg.com/bootstrap-table@1.21.1/dist/bootstrap-table.min.js"></script>
            <script src="https://unpkg.com/bootstrap-table@1.21.1/dist/extensions/export/bootstrap-table-export.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.16.9/xlsx.full.min.js"></script>
            <script>
                document.getElementById('exportBtn').addEventListener('click', function() {
                    const table = document.getElementById('gasTable');
                    const wb = XLSX.utils.table_to_book(table, { sheet: 'Gas Consumption' });
                    XLSX.writeFile(wb, 'gas_consumption.xlsx');
                });
            </script>
        </body>
        </html>`;

        res.send(html);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    } finally {
        await client.end();
    }
});

// Serve the charging events page
app.get('/view_charging_events', async (req, res) => {
    const { startDate, endDate } = req.query;

    const client = new Client(dbConfig);
    let query = `
        SELECT id, start_time, end_time, energy_used, estimated_cost, settled, percent_charged, ignore_event
        FROM charging_events
    `;
    let queryParams = [];

    if (startDate && endDate) {
        query += ' WHERE start_time >= $1 AND end_time <= $2';
        queryParams.push(startDate, endDate);
    }

    query += ' ORDER BY start_time';

    try {
        await client.connect();
        const result = await client.query(query, queryParams);

        let html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Charging Events Data</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            <link rel="stylesheet" href="https://unpkg.com/bootstrap-table@1.21.1/dist/bootstrap-table.min.css">
        </head>
        <body>
            <div class="container mt-4">
                <h1>Charging Events Data</h1>

                <form method="GET" class="mb-4">
                    <div class="row">
                        <div class="col-md-5">
                            <input type="datetime-local" name="startDate" class="form-control" value="${startDate || ''}" required>
                        </div>
                        <div class="col-md-5">
                            <input type="datetime-local" name="endDate" class="form-control" value="${endDate || ''}" required>
                        </div>
                        <div class="col-md-2">
                            <button type="submit" class="btn btn-primary">Filter</button>
                        </div>
                    </div>
                </form>

                <button id="exportBtn" class="btn btn-primary mb-3">Export to CSV</button>
                <table 
                    id="chargingEventsTable" 
                    class="table table-bordered table-hover"
                    data-toggle="table" 
                    data-search="true" 
                    data-pagination="true"
                    data-show-columns="true"
                    data-page-size="10" 
                    data-page-list="[5, 10, 20, 50]"
                    data-toolbar="#toolbar">
                    <thead>
                        <tr>
                            <th data-field="id" data-sortable="true">ID</th>
                            <th data-field="start_time" data-sortable="true">Start Time</th>
                            <th data-field="end_time" data-sortable="true">End Time</th>
                            <th data-field="energy_used" data-sortable="true">Energy Used (kWh)</th>
                            <th data-field="estimated_cost" data-sortable="true">Estimated Cost (£)</th>
                            <th data-field="settled" data-sortable="true">Settled</th>
                            <th data-field="percent_charged" data-sortable="true">Percent Charged (%)</th>
                            <th data-field="ignore_event" data-sortable="true">Ignore Event</th>
                        </tr>
                    </thead>
                    <tbody>`;

        result.rows.forEach(row => {
            html += `
            <tr>
                <td>${row.id}</td>
                <td>${new Date(row.start_time).toLocaleString()}</td>
                <td>${row.end_time ? new Date(row.end_time).toLocaleString() : ''}</td>
                <td>${row.energy_used ? parseFloat(row.energy_used).toFixed(3) : ''}</td>
                <td>${row.estimated_cost ? parseFloat(row.estimated_cost).toFixed(2) : ''}</td>
                <td>${row.settled ? 'Yes' : 'No'}</td>
                <td>${row.percent_charged || ''}</td>
                <td>${row.ignore_event ? 'Yes' : 'No'}</td>
            </tr>`;
        });

        html += `
                    </tbody>
                </table>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
            <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
            <script src="https://unpkg.com/bootstrap-table@1.21.1/dist/bootstrap-table.min.js"></script>
            <script src="https://unpkg.com/bootstrap-table@1.21.1/dist/extensions/export/bootstrap-table-export.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.16.9/xlsx.full.min.js"></script>
            <script>
                document.getElementById('exportBtn').addEventListener('click', function() {
                    const table = document.getElementById('chargingEventsTable');
                    const wb = XLSX.utils.table_to_book(table, { sheet: 'Charging Events' });
                    XLSX.writeFile(wb, 'charging_events.xlsx');
                });
            </script>
        </body>
        </html>`;

        res.send(html);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    } finally {
        await client.end();
    }
});



// Start the server
app.listen(port, () => {
    console.log(`Web server running on port ${port}. Access it at http://localhost:${port}/view_electric or http://localhost:${port}/view_gas`);
});
