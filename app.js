const express = require("express");
const cfenv = require("cfenv");
require('custom-env').env('prod', './env');
const bodyParser = require("body-parser");
const serveIndex = require('serve-index');
const archiver = require('archiver');
const fs = require('fs');
const basicAuth = require('express-basic-auth')

const { start, stop, randomMilliseconds, scheduleCsrfRefreshAndExecute } = require('./src/fetch');
const { processOut } = require('./src/processOut');
const { clone, commitAll } = require("./src/git");

const app = express();

// protect all routes with basic auth
app.use(basicAuth({
  users: { 'user': 'vsdh' },
  challenge: true, // prompt if unauthenticated
  unauthorizedResponse: 'not authenticated'
}));

// parse requests of content-type: application/json
app.use(bodyParser.json());

// parse requests of content-type: application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

// get CloudFoundry variables
const appEnv = cfenv.getAppEnv();

// add logger
const SimpleNodeLogger = require('simple-node-logger');
const opts = {
  logFilePath: './reports/calls-report-logfile.log',
  timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS'
};
const log = SimpleNodeLogger.createSimpleLogger(opts);
process.env.logger = log;

// index.html
app.use('/', express.static(__dirname + '/reports'));

// inject apigee authentication
app.post("/authenticate", (req, res) => {
  log.info('/authenticate');
  if (req && req.body && req.body.cookie && req.body["x-apigee-classic-csrf"]) {
    process.env.xApigeeClassicCsrf = req.body["x-apigee-classic-csrf"];
    process.env.cookie = req.body.cookie;
    res.json({ message: "Successful" });
  } else {
    res.json({ message: 'cookie and x-apigee-classic-csrf expected' });
  }
});

// inject git personal accesstoken
app.post("/personalaccesstoken", (req, res) => {
  log.info('/personalaccesstoken');
  if (req && req.body && req.body.token) {
    process.env.personalaccesstoken = req.body.token;
    clone(log);
    res.json({ message: "Successful" });
  } else {
    res.json({ message: 'token expected' });
  }
});

// commit & push out folder
app.get("/commit", (req, res) => {
  log.info('/commit');
  const cb = (resJson) => {
    log.info(resJson);
    res.json(resJson);
  }
  const commitResult = commitAll(log);
  log.info({ commitResult });
  if (commitResult) {
    processOut(cb);
  } else {
    cb('Could not commit. Check server logs.');
  }
});

app.post("/timerange", (req, res) => {
  log.info('/timerange');
  if (req && req.body && req.body.from && req.body.to) {
    const cb = (msg) => {
      log.info(msg);
      res.json({ message: msg });
    }
    fetchBetween(req.body.from, req.body.to, cb);
  } else {
    res.json({ message: 'from and to expected' });
  }
});

app.post("/config", (req, res) => {
  log.info('/config');
  if (req && req.body && req.body.min && req.body.max
    && (typeof req.body.min === 'number')
    && (typeof req.body.max === 'number')) {
    process.env.min = req.body.min;
    process.env.max = req.body.max;
    res.json({ message: "Successful", randomTest: randomMilliseconds().toString() });
  } else {
    res.json({ message: 'min and max in milliseconds expected' });
  }
});

app.post("/start", (req, res) => {
  log.info('/start');
  const cb = (msg) => {
    log.info(msg);
    res.json({ message: msg });
  };
  const errcb = (msg) => {
    log.error(msg);
    res.json({ message: msg });
  }

  if (req && req.body && req.body.from && req.body.days
    && (typeof req.body.from === 'string')
    && (typeof req.body.days == 'number')) {
    process.env.from = req.body.from;
    process.env.days = req.body.days;
    start(cb, errcb, log);
  } else {
    res.json({ message: 'from and days expected' });
  }
});

app.get("/stop", (req, res) => {
  log.info('/stop');
  const cb = (msg) => {
    log.info(msg);
    res.json({ message: msg });
  };
  const errcb = (msg) => {
    log.error(msg);
    res.json({ message: msg });
  }
  stop(cb, errcb);
});

app.get("/process", (req, res) => {
  log.info('/process');
  const cb = (resJson) => {
    log.info(resJson);
    res.json(resJson);
  }
  processOut(cb);
});

// The express.static serves the file contents
// The serveIndex is this module serving the directory-structure
app.use('/out', express.static(__dirname + '/out'), serveIndex(__dirname + '/out', { 'icons': true }));

app.use('/zips', express.static(__dirname + '/zips'), serveIndex(__dirname + '/zips', { 'icons': true }));

app.use('/zip', (req, res) => {
  // create archive
  const archive = archiver.create('zip', {});
  const output = fs.createWriteStream(__dirname + '/zips/out.zip');

  // register events
  output.on('close', function () {
    log.info('archiver has been finalized and the output file descriptor has closed.');
    res.json({ message: 'done' });
  });
  output.on('end', function () {
    log.info('Data has been drained');
    res.json({ message: 'done' });
  });
  archive.on('warning', function (err) {
    if (err.code === 'ENOENT') {
      log.error(err);
      res.json({ message: err });
    } else {
      res.json({ message: err });
      throw err;
    }
  });
  archive.on('error', function (err) {
    res.json({ message: err });
    throw err;
  });

  // write
  archive.pipe(output);
  archive
    .directory(__dirname + '/out')
    .finalize();
});

// refresh csfr-token
// this is exposd for testing propusos
// use the scheduleCsrfRefreshAndExecute_mock()
app.get('/refresh', (req, res) => {
  scheduleCsrfRefreshAndExecute();
  res.json({ message: 'done' });
})

// set port, listen for requests
app.listen(appEnv.port, appEnv.bind, () => {
  log.info("Server is running on " + appEnv.url);
});
