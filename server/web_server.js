const express = require('express');
const fs = require('fs');
const { Client } = require('pg');
const path = require('path');

const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

const app = express();
const port = 52529;

// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Middleware to parse incoming JSON data in the request body
app.use(express.json());

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
        SELECT id, start_time, end_time, energy_used, estimated_cost, 
               settled, percent_charged, ignore_event, comment
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
                            <th data-field="comment" data-sortable="true">Comment</th>  <!-- Added Comment Column -->
                        </tr>
                    </thead>
                    <tbody>`;

        result.rows.forEach(row => {
            let estimatedCostFormatted = row.estimated_cost
            ? `£${(Math.round(row.estimated_cost) / 100).toFixed(2)}`
            : 'N/A';
            let comment = row.comment || 'N/A';  // Default 'N/A' if no comment
            html += `
            <tr>
                <td><a href="/view_charge_event/${row.id}">${row.id}</a></td> <!-- Make Row ID clickable -->
                <td>${new Date(row.start_time).toLocaleString()}</td>
                <td>${row.end_time ? new Date(row.end_time).toLocaleString() : ''}</td>
                <td>${row.energy_used ? parseFloat(row.energy_used).toFixed(3) : ''}</td>
                <td>${estimatedCostFormatted}</td>
                <td>${row.settled ? 'Yes' : 'No'}</td>
                <td>${row.percent_charged || ''}</td>
                <td>${row.ignore_event ? 'Yes' : 'No'}</td>
                <td>${comment}</td> <!-- Added Comment to the table -->
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




// Serve the detailed view for a specific charging event
app.get('/view_charge_event/:id_number', async (req, res) => {
    const { id_number } = req.params;
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Query the specific charging event by ID
        const result = await client.query(`
            SELECT id, start_time, end_time, energy_used, estimated_cost, settled, percent_charged, ignore_event, comment
            FROM charging_events 
            WHERE id = $1
        `, [id_number]);

        if (result.rows.length === 0) {
            res.status(404).send('Charging event not found.');
            return;
        }

        const event = result.rows[0];

        // Format estimated_cost from pence to pounds and round to 2 decimal places
        const estimatedCostFormatted = event.estimated_cost
            ? `£${(Math.round(event.estimated_cost) / 100).toFixed(2)}`
            : 'N/A';

        // Generate HTML for the event details with a textarea for the comment
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Charging Event Details</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        </head>
        <body>
            <div class="container mt-4">
                <h1>Charging Event Details</h1>
                <table class="table table-bordered">
                    <tr>
                        <th>ID</th>
                        <td>${event.id}</td>
                    </tr>
                    <tr>
                        <th>Start Time</th>
                        <td>${new Date(event.start_time).toLocaleString()}</td>
                    </tr>
                    <tr>
                        <th>End Time</th>
                        <td>${event.end_time ? new Date(event.end_time).toLocaleString() : 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Energy Used (kWh)</th>
                        <td>${event.energy_used ? parseFloat(event.energy_used).toFixed(3) : 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Estimated Cost (£)</th>
                        <td>${estimatedCostFormatted}</td>
                    </tr>
                    <tr>
                        <th>Settled</th>
                        <td>${event.settled ? 'Yes' : 'No'}</td>
                    </tr>
                    <tr>
                        <th>Percent Charged (%)</th>
                        <td>${event.percent_charged || 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Ignore Event</th>
                        <td>${event.ignore_event ? 'Yes' : 'No'}</td>
                    </tr>
                    <tr>
                        <th>Comment</th>
                        <td>
                            <textarea id="comment" class="form-control" rows="4">${event.comment || ''}</textarea>
                            <button id="saveComment" class="btn btn-primary mt-3">Save Comment</button>
                        </td>
                    </tr>
                </table>
                <a href="/view_charging_events" class="btn btn-secondary mt-3">Back to All Charging Events</a>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/jquery@3.6.0/dist/jquery.min.js"></script>
            <script>
                // Pass event ID as a global variable to the script
                const eventId = ${event.id};  // Injecting the event ID into the script

                document.getElementById('saveComment').addEventListener('click', async function() {
                    const comment = document.getElementById('comment').value;
                    try {
                        const response = await fetch('/update_table', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ id: eventId, comment: comment })
                        });

                        if (response.ok) {
                            alert('Comment updated successfully!');
                            window.location.reload();  // Reload to reflect changes
                        } else {
                            const error = await response.text();  // Get error response body
                            alert(\`Failed to update comment: \${error}\`);
                        }
                    } catch (error) {
                        console.error('Error sending request:', error);
                        alert('Error sending request to server');
                    }
                });
            </script>
        </body>
        </html>`;

        res.send(html);
    } catch (error) {
        console.error('Error fetching charging event details:', error);
        res.status(500).send('Error fetching charging event details');
    } finally {
        await client.end();
    }
});



// Endpoint to update the comment in the charging_events table
app.post('/update_table', async (req, res) => {
    const { id, comment } = req.body;
    const client = new Client(dbConfig);

    console.log(req.body);

    try {
        await client.connect();

        // Update the comment for the specific charging event
        const result = await client.query(`
            UPDATE charging_events
            SET comment = $1
            WHERE id = $2
            RETURNING id, comment;
        `, [comment, id]);

        if (result.rowCount === 0) {
            return res.status(404).send('Charging event not found');
        }

        console.log(`Updated comment for event ID ${id}: ${result.rows[0].comment}`);
        res.status(200).send('Comment updated successfully');
    } catch (error) {
        console.error('Error updating comment:', error);
        res.status(500).send('Error updating comment');
    } finally {
        await client.end();
    }
});



app.get('/view_charge_event_error/:id_number', async (req, res) => {
    const { id_number } = req.params;
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Query the specific charging event by ID
        const result = await client.query(`
            SELECT id, start_time, end_time, energy_used, estimated_cost, settled, percent_charged, ignore_event
            FROM charging_events 
            WHERE id = $1
        `, [id_number]);

        if (result.rows.length === 0) {
            res.status(404).send('Charging event not found.');
            return;
        }

        const event = result.rows[0];

        // Format estimated_cost from pence to pounds and round to 2 decimal places
        const estimatedCostFormatted = event.estimated_cost
            ? `£${(Math.round(event.estimated_cost) / 100).toFixed(2)}`
            : 'N/A';

        // Generate HTML for the error page
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Error: Charging Event</title>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        </head>
        <body>
            <div class="container mt-4">
                <h1 class="text-danger">Error Processing Charging Event</h1>
                <p class="text-warning">There was an issue processing this charging event. Please review the details below and try again or contact support.</p>
                
                <table class="table table-bordered">
                    <tr>
                        <th>ID</th>
                        <td>${event.id}</td>
                    </tr>
                    <tr>
                        <th>Start Time</th>
                        <td>${new Date(event.start_time).toLocaleString()}</td>
                    </tr>
                    <tr>
                        <th>End Time</th>
                        <td>${event.end_time ? new Date(event.end_time).toLocaleString() : 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Energy Used (kWh)</th>
                        <td>${event.energy_used ? parseFloat(event.energy_used).toFixed(3) : 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Estimated Cost (£)</th>
                        <td>${estimatedCostFormatted}</td>
                    </tr>
                    <tr>
                        <th>Settled</th>
                        <td>${event.settled ? 'Yes' : 'No'}</td>
                    </tr>
                    <tr>
                        <th>Percent Charged (%)</th>
                        <td>${event.percent_charged || 'N/A'}</td>
                    </tr>
                    <tr>
                        <th>Ignore Event</th>
                        <td>${event.ignore_event ? 'Yes' : 'No'}</td>
                    </tr>
                </table>
                
                <a href="/view_charging_events" class="btn btn-secondary mt-3">Back to All Charging Events</a>
            </div>
        </body>
        </html>`;

        res.send(html);
    } catch (error) {
        console.error('Error fetching charging event details:', error);
        res.status(500).send('Error fetching charging event details');
    } finally {
        await client.end();
    }
});

//PICO Server
// Endpoint to serve energy data for the Pico
app.get('/pico_display', async (req, res) => {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Step 1: Find the most recent full 24-hour period (the most recent date with a full day of data)
        const latestDateQuery = `
            SELECT DATE(start_time) AS data_date
            FROM electric_consumption
            GROUP BY data_date
            ORDER BY data_date DESC
            LIMIT 1;
        `;
        const latestDateResult = await client.query(latestDateQuery);

        if (latestDateResult.rowCount === 0) {
            return res.status(404).send('No data available in electric_consumption table.');
        }

        const latestDate = latestDateResult.rows[0].data_date; // Most recent date with full 24h data

        // Step 2: Calculate the 8-day range (1 extra day for context + 7 full days)
        const startDate = new Date(latestDate);
        startDate.setDate(startDate.getDate() - 7); // Go back 7 full days before the latest date

        const startDateString = startDate.toISOString().split('T')[0]; // Format as YYYY-MM-DD
        const endDateString = latestDate; // Up to the most recent full day

        // Step 3: Fetch electric consumption data for the last 8 days
        const electricQuery = `
            SELECT DATE(start_time) AS date, SUM(consumption_kwh) AS electric_usage
            FROM electric_consumption
            WHERE start_time::date BETWEEN $1 AND $2
            GROUP BY date
            ORDER BY date;
        `;
        const electricResult = await client.query(electricQuery, [startDateString, endDateString]);

        // Log the raw electric data to debug
        console.log("Electric Data Raw Result:", electricResult.rows);

        // Step 4: Fetch gas consumption data for the last 8 days
        const gasQuery = `
            SELECT DATE(start_time) AS date, SUM(consumption_kwh) AS gas_usage
            FROM gas_consumption
            WHERE start_time::date BETWEEN $1 AND $2
            GROUP BY date
            ORDER BY date;
        `;
        const gasResult = await client.query(gasQuery, [startDateString, endDateString]);

        // Log the raw gas data to debug
        console.log("Gas Data Raw Result:", gasResult.rows);

        // Step 5: Map and merge the data into the expected format for the Pico
        // Ensure that the date format is consistent by stripping out the time component from the raw data
        const electricDataMap = new Map(
            electricResult.rows.map(row => [row.date.toISOString().split('T')[0], row.electric_usage])
        );
        const gasDataMap = new Map(
            gasResult.rows.map(row => [row.date.toISOString().split('T')[0], row.gas_usage])
        );

        const sample_energy_data = [];
        for (let i = 0; i <= 7; i++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + i);
            const dateString = currentDate.toISOString().split('T')[0];

            // Log dateString to check if the correct date is being used
            console.log("Processing data for date:", dateString);

            sample_energy_data.push({
                date: dateString,
                electric_usage: electricDataMap.get(dateString) || "0.0",
                gas_usage: gasDataMap.get(dateString) || "0.0"
            });
        }

        const energy_data = {
            "output": sample_energy_data
        };

        // Send the energy data as a JSON response
        res.json(energy_data);

    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).send('Error fetching data');
    } finally {
        await client.end();
    }
});

app.get('/pico_summary', async (req, res) => {
    const client = new Client(dbConfig);

    try {
        await client.connect();

        // Print the date range we're querying to ensure the period is correct
        const today = new Date();
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 9); // Offset by 2 days
        console.log(`Fetching data for the last 7 days: from ${sevenDaysAgo.toISOString()} to ${today.toISOString()}`);

        // Step 1: Calculate the 7-Day Cost (last 7 days) for Gas
        const sevenDayGasCostQuery = `
            SELECT 
                DATE(start_time) AS date,
                SUM(price_pence) AS gas_cost
            FROM gas_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '9 DAY'  -- Offset by 2 days
            GROUP BY DATE(start_time)
            ORDER BY DATE(start_time) DESC;
        `;
        const sevenDayGasCostResult = await client.query(sevenDayGasCostQuery);

        if (sevenDayGasCostResult.rowCount === 0) {
            console.log('No gas data available for the last 7 days.');
            return res.status(404).send('No gas data available for the last 7 days.');
        }

        // Debug: log the raw gas cost data for the last 7 days
        console.log("Seven Day Gas Cost Data:", sevenDayGasCostResult.rows);

        // Step 2: Calculate the 7-Day Cost for Electric
        const sevenDayElectricCostQuery = `
            SELECT 
                DATE(start_time) AS date,
                SUM(price_pence) AS electric_cost
            FROM electric_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '9 DAY'  -- Offset by 2 days
            GROUP BY DATE(start_time)
            ORDER BY DATE(start_time) DESC;
        `;
        const sevenDayElectricCostResult = await client.query(sevenDayElectricCostQuery);

        if (sevenDayElectricCostResult.rowCount === 0) {
            console.log('No electric data available for the last 7 days.');
            return res.status(404).send('No electric data available for the last 7 days.');
        }

        // Debug: log the raw electric cost data for the last 7 days
        console.log("Seven Day Electric Cost Data:", sevenDayElectricCostResult.rows);

        // Step 3: Merge Gas and Electric Data for the Last 7 Days
        const sevenDayGasData = new Map(sevenDayGasCostResult.rows.map(row => [row.date.toISOString().split('T')[0], row.gas_cost]));
        const sevenDayElectricData = new Map(sevenDayElectricCostResult.rows.map(row => [row.date.toISOString().split('T')[0], row.electric_cost]));

        let totalSevenDayCost = 0;

        // Add both gas and electric costs for each day
        for (let i = 0; i < 7; i++) {
            const date = new Date();
            date.setDate(date.getDate() - (i + 2));  // Offset each day by 2 days
            const dateString = date.toISOString().split('T')[0]; // Get date in YYYY-MM-DD format

            const gasCost = (sevenDayGasData.get(dateString) || 0) / 100; // Convert pence to pounds
            const electricCost = (sevenDayElectricData.get(dateString) || 0) / 100; // Convert pence to pounds
            totalSevenDayCost += gasCost + electricCost;
        }

        // Debug: Print the total cost for the last 7 days
        console.log(`Total 7-Day Cost: £${totalSevenDayCost.toFixed(2)}`);

        // Step 4: Calculate the current month's cost (from the 1st of the current month to today) for Gas
        const currentMonthGasCostQuery = `
            SELECT 
                SUM(price_pence) AS gas_cost
            FROM gas_consumption
            WHERE start_time >= DATE_TRUNC('month', CURRENT_DATE);
        `;
        const currentMonthGasCostResult = await client.query(currentMonthGasCostQuery);

        if (currentMonthGasCostResult.rowCount === 0) {
            console.log('No gas data available for the current month.');
            return res.status(404).send('No gas data available for the current month.');
        }

        const currentMonthGasCost = (currentMonthGasCostResult.rows[0].gas_cost || 0) / 100;

        // Step 5: Calculate the current month's cost for Electric
        const currentMonthElectricCostQuery = `
            SELECT 
                SUM(price_pence) AS electric_cost
            FROM electric_consumption
            WHERE start_time >= DATE_TRUNC('month', CURRENT_DATE);
        `;
        const currentMonthElectricCostResult = await client.query(currentMonthElectricCostQuery);

        if (currentMonthElectricCostResult.rowCount === 0) {
            console.log('No electric data available for the current month.');
            return res.status(404).send('No electric data available for the current month.');
        }

        const currentMonthElectricCost = (currentMonthElectricCostResult.rows[0].electric_cost || 0) / 100;

        // Step 6: Calculate the cost for the previous 7 days (for the difference calculation)
        const previousSevenDayGasCostQuery = `
            SELECT 
                SUM(price_pence) AS gas_cost
            FROM gas_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '16 DAY'
            AND start_time < CURRENT_DATE - INTERVAL '9 DAY';  -- Adjust for the previous 7 days
        `;
        const previousSevenDayGasCostResult = await client.query(previousSevenDayGasCostQuery);

        if (previousSevenDayGasCostResult.rowCount === 0) {
            console.log('No gas data available for the previous 7 days.');
            return res.status(404).send('No gas data available for the previous 7 days.');
        }

        const previousSevenDayGasCost = (previousSevenDayGasCostResult.rows[0].gas_cost || 0) / 100;

        const previousSevenDayElectricCostQuery = `
            SELECT 
                SUM(price_pence) AS electric_cost
            FROM electric_consumption
            WHERE start_time >= CURRENT_DATE - INTERVAL '16 DAY'
            AND start_time < CURRENT_DATE - INTERVAL '9 DAY';  -- Adjust for the previous 7 days
        `;
        const previousSevenDayElectricCostResult = await client.query(previousSevenDayElectricCostQuery);

        if (previousSevenDayElectricCostResult.rowCount === 0) {
            console.log('No electric data available for the previous 7 days.');
            return res.status(404).send('No electric data available for the previous 7 days.');
        }

        const previousSevenDayElectricCost = (previousSevenDayElectricCostResult.rows[0].electric_cost || 0) / 100;

        // Step 7: Calculate the Difference between the current and previous 7-day costs
        const difference = (totalSevenDayCost - (previousSevenDayGasCost + previousSevenDayElectricCost)).toFixed(2);

        // Construct the summary data response
        const summaryData = {
            "7-Day Cost": totalSevenDayCost.toFixed(2),  // Format to 2 decimal places
            "Difference": difference,  // Difference is already formatted
            "This Month": (currentMonthGasCost + currentMonthElectricCost).toFixed(2) // Format to 2 decimal places
        };

        // Send the summary data as a JSON response
        res.json(summaryData);

    } catch (error) {
        console.error('Error fetching summary data:', error);
        res.status(500).send('Error fetching summary data');
    } finally {
        await client.end();
    }
});






// Start the server
app.listen(port, () => {
    console.log(`Web server running on port ${port}. Access it at http://localhost:${port}/view_electric or http://localhost:${port}/view_gas`);
});
