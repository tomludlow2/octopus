const fs = require('fs');
const { Client } = require('pg');
const path = require('path');
const { format } = require('date-fns'); // You may need to install date-fns

// Load sensitive database connection data
const dbConfig = JSON.parse(fs.readFileSync('../db_connect.json', 'utf8'));

// Function to export audi_events to CSV
async function exportAudiEventsToCSV() {
  const client = new Client(dbConfig);

  try {
    await client.connect();
    
    // Fetch data from audi_events table
    const res = await client.query('SELECT * FROM audi_events ORDER BY event_time ASC');
    const events = res.rows;

    // Define CSV headers
    const headers = ['entity_id', 'new_state', 'event_time'];
    const csvData = [headers.join(','), ...events.map(event => [event.entity_id, event.new_state, event.event_time].join(','))].join('\n');

    // Define the output file path with current date and time
    const now = new Date();
    const fileName = `audi_event_report_${format(now, 'dd_MM_yy_HH_mm')}.csv`;
    const filePath = path.join(__dirname, '../reports', fileName);

    // Write CSV data to file
    fs.writeFileSync(filePath, csvData);
    console.log(`CSV file successfully created at: ${filePath}`);
  } catch (error) {
    console.error('Error exporting audi_events to CSV:', error);
  } finally {
    await client.end();
  }
}

// Run the function to export audi_events
exportAudiEventsToCSV();
