/*
    LoggedStations v. 0.0.3c
*/

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const https = require('https');

const rootDir = process.cwd();
const config = require(path.join(rootDir, 'config.json'));
const endpointsRouter = require(path.join(rootDir, 'server', 'endpoints'));
const { logInfo, logError } = require(path.join(rootDir, 'server', 'console'));

// TextDecoder helper: use global if available, otherwise try util.TextDecoder
let TextDecoderImpl = global.TextDecoder;
try {
    if (!TextDecoderImpl) {
        const util = require('util');
        TextDecoderImpl = util.TextDecoder;
    }
} catch (e) {
    TextDecoderImpl = TextDecoderImpl || null;
}

const pluginName = "LoggedStations";

const csvDirectory = path.join(__dirname, 'files');
const uploadedStorePath = path.join(__dirname, 'uploadedFiles.json');
const settingsPath = path.join(rootDir, 'plugins_configs', 'LoggedStations.json');

// Assicurati che le directory necessarie esistano all'avvio
try {
    if (!fs.existsSync(csvDirectory)) {
        fs.mkdirSync(csvDirectory, { recursive: true });
        logInfo(`[${pluginName}] Created missing 'files' directory.`);
    }
} catch (e) {
    logError(`[${pluginName}] Error creating directories:`, e);
}

function loadUploadedStore() {
    try {
        if (fs.existsSync(uploadedStorePath)) {
            const raw = fs.readFileSync(uploadedStorePath, 'utf8');
            return JSON.parse(raw || '{}');
        }
    } catch (e) {
        logError(`[${pluginName}] Error loading uploaded store:`, e);
    }
    return {};
}

function saveUploadedStore(store) {
    try {
        fs.writeFileSync(uploadedStorePath, JSON.stringify(store, null, 2), 'utf8');
    } catch (e) {
        logError(`[${pluginName}] Error saving uploaded store:`, e);
    }
}

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            const raw = fs.readFileSync(settingsPath, 'utf8');
            return JSON.parse(raw || '{}');
        }
    } catch (e) {
        logError(`[${pluginName}] Error loading settings:`, e);
    }
    return {
        startupBehavior: "server",
        remoteUrl: "",
        fmlistOmid: "",
        showToAllUsers: true
    };
}

// ==============================
// Settings endpoints
// ==============================
endpointsRouter.get('/plugins/LoggedStations/settings', (req, res) => {
    res.json(loadSettings());
});

endpointsRouter.post('/plugins/LoggedStations/settings', express.json(), (req, res) => {
    try {
        const settings = req.body;
        if (!fs.existsSync(path.dirname(settingsPath))) {
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        }
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        res.json({ ok: true });
    } catch (e) {
        logError(`[${pluginName}] Error saving settings:`, e);
        res.status(500).json({ ok: false });
    }
});

// ==============================
// File list endpoint
// ==============================
endpointsRouter.get('/plugins/LoggedStations/files', (req, res) => {
    try {
        const allFiles = fs.readdirSync(csvDirectory);
        const csvFiles = allFiles.filter(f => f.toLowerCase().endsWith('.csv'));
        const uploadedStore = loadUploadedStore();

        const result = csvFiles.map(f => {
            const full = path.join(csvDirectory, f);
            let stat;
            try { stat = fs.statSync(full); } catch (e) { stat = null; }
            const mtimeMs = stat ? stat.mtimeMs : null;
            const uploaded = mtimeMs && uploadedStore[f] && uploadedStore[f] === mtimeMs;
            return { name: f, mtimeMs, uploaded };
        });

        if (result.length === 0) {
            logInfo(`[${pluginName}] No CSV files found in 'files' folder.`);
        } else {
            logInfo(`[${pluginName}] Found ${result.length} CSV file(s).`);
        }

        res.json(result);

    } catch (err) {
        if (err.code === 'ENOENT') {
            logError(`[${pluginName}] The 'files' folder was not found.`);
        } else {
            logError(`[${pluginName}] Error reading CSV files:`, err);
        }
        res.status(500).json([]);
    }
});

// ==============================
// CSV file download endpoint
// ==============================
endpointsRouter.get('/plugins/LoggedStations/files/:filename', (req, res) => {
    const fileName = req.params.filename;
    const filePath = path.join(csvDirectory, fileName);

    fs.readFile(filePath, (err, buffer) => {
        if (err) {
            if (err.code === 'ENOENT') {
                logError(`[${pluginName}] File not found: ${fileName}`);
                return res.status(404).send(`File not found: ${fileName}`);
            } else {
                logError(`[${pluginName}] Error reading file ${fileName}:`, err);
                return res.status(500).send(`Error reading file: ${fileName}`);
            }
        }

        // Buffer decoding: try windows-1252 (ANSI), fallback utf-8
        let data;
        if (TextDecoderImpl) {
            try {
                const decoder = new TextDecoderImpl('windows-1252');
                data = decoder.decode(buffer);
            } catch (e) {
                data = buffer.toString('utf8');
            }
        } else {
            data = buffer.toString('utf8');
        }

        // Count CSV lines
        const lineCount = data.split(/\r?\n/).length;
        logInfo(`[${pluginName}] Served CSV file: ${fileName} (${lineCount} lines)`);

        res.setHeader('Content-Type', 'text/csv');
        res.send(data);
    });
});

// Endpoint to mark file as uploaded (client calls after import)
endpointsRouter.post('/plugins/LoggedStations/files/:filename/markUploaded', express.json(), (req, res) => {
    const fileName = req.params.filename;
    const filePath = path.join(csvDirectory, fileName);

    try {
        const stat = fs.statSync(filePath);
        const mtimeMs = stat.mtimeMs;
        const store = loadUploadedStore();
        store[fileName] = mtimeMs;
        saveUploadedStore(store);
        logInfo(`[${pluginName}] Marked uploaded: ${fileName} (${mtimeMs})`);
        return res.json({ ok: true, name: fileName, mtimeMs });
    } catch (e) {
        logError(`[${pluginName}] Error marking uploaded for ${fileName}:`, e);
        return res.status(500).json({ ok: false });
    }
});

// Endpoint to remove the 'uploaded' mark (client can force re-import)
endpointsRouter.post('/plugins/LoggedStations/files/:filename/unmarkUploaded', express.json(), (req, res) => {
    const fileName = req.params.filename;
    try {
        const store = loadUploadedStore();
        if (store[fileName]) {
            delete store[fileName];
            saveUploadedStore(store);
            logInfo(`[${pluginName}] Unmarked uploaded: ${fileName}`);
        } else {
            logInfo(`[${pluginName}] Unmark requested but no entry found for: ${fileName}`);
        }
        return res.json({ ok: true, name: fileName });
    } catch (e) {
        logError(`[${pluginName}] Error unmarking uploaded for ${fileName}:`, e);
        return res.status(500).json({ ok: false });
    }
});

// ==============================
// FMLIST log endpoint
// ==============================
endpointsRouter.post('/plugins/LoggedStations/fmlistLog', express.json(), (req, res) => {
    const data = req.body;
    
    if (!config.identification.token) {
        logError(`[${pluginName}] FMLIST Log failed: UUID token missing in config.json`);
        return res.status(400).json({ ok: false, error: 'UUID token missing' });
    }

    const pSettings = loadSettings();
    const omid = pSettings.fmlistOmid || config.extras?.fmlistOmid || "";
    const freq = parseFloat(data.freq).toFixed(2);
    const distance = parseFloat(data.distance);
    
    // Determine propagation type (as in scanner_server.js)
    const type = distance < 900 ? 'Tropo' : 'Sporadic-E';
    const shortServerName = config.identification.tunerName.split(' ')[0];

    // Prepare data packet for FMLIST
    const postData = JSON.stringify({
        station: {
            freq: parseFloat(freq),
            pi: data.pi || "",
            id: data.stationid || "",
            rds_ps: (data.ps || "").replace(/'/g, "\\'"),
            signal: 40, // Default value in dBµV since there is no real signal in the static log
            tp: 0,
            ta: 0,
            af_list: []
        },
        server: {
            uuid: config.identification.token,
            latitude: config.identification.lat,
            longitude: config.identification.lon,
            address: config.identification.proxyIp.length > 1
                ? config.identification.proxyIp
                : ('Matches request IP with port ' + config.webserver.port),
            webserver_name: config.identification.tunerName.replace(/'/g, "\\'"),
            omid: omid
        },
        type: type,
        log_msg: `${shortServerName} ${(data.ps || 'Station').replace(/\s+/g, '_')}, PI: ${data.pi || '?'}, Signal: 40 dBµV [Dist: ${distance}km]`
    });
    console.log(postData);

    const options = {
        hostname: 'api.fmlist.org',
        path: '/fmdx.org/slog.php',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const request = https.request(options, (response) => {
        let responseData = '';
        response.on('data', (chunk) => { responseData += chunk; });
        response.on('end', () => {
            if (responseData.includes('OK!')) {
                logInfo(`[${pluginName}] FMLIST Log successful for ${freq} MHz`);
                res.json({ ok: true });
            } else {
                logError(`[${pluginName}] FMLIST API returned error: ${responseData}`);
                res.status(500).json({ ok: false, error: responseData });
            }
        });
    });

    request.on('error', (error) => {
        logError(`[${pluginName}] FMLIST Request error:`, error);
        res.status(500).json({ ok: false, error: error.message });
    });

    request.write(postData);
    request.end();
});

// ==============================
// Startup log
// ==============================
logInfo(`[${pluginName}] Backend endpoints initialized: /files, /files/:filename`);
