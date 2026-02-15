const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 52530;

// Middleware to parse JSON body
app.use(express.json());

app.post('/log', (req, res) => {
    const now = new Date();
    const timestamp = `${String(now.getFullYear()).slice(-2)}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    const logData = {
        timestamp: now.toISOString(),
        data: req.body
    };

    console.log( req.body);

    const filePath = path.join(__dirname, 'webhook_calls', `${timestamp}.json`);

    // Ensure the directory exists
    fs.mkdir(path.dirname(filePath), { recursive: true }, (err) => {
        if (err) {
            console.error('Error creating directory:', err);
            return res.status(500).send('Internal Server Error');
        }

        fs.writeFile(filePath, JSON.stringify(logData, null, 2), (err) => {
            if (err) {
                console.error('Error writing file:', err);
                return res.status(500).send('Internal Server Error');
            }

            res.status(200).send('Data logged successfully');
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
