const moment = require('moment');
const got = require('got');
const tunnel = require('tunnel');
const fs = require('fs');
const { asyncFunctionDelay } = require("async-function-delay");
const mailClient = require('./mails/email-controller');
const { processOut } = require('./processOut');
const { commitAll } = require("./git");

const INPUT_DATE_FORMAT = 'DD.MM.YYYY';
let authMailSent = false;
let shouldStopRequested = false;
let errorCount = 0;
let log = process.env.logger;

const shouldStop = () => {
    const shouldStop = (errorCount > 4) || shouldStopRequested;
    return shouldStop;
}

const start = (cb, errcb, _log) => {
    if (!log) log = _log;
    // creation of /out folder happens when git repo is cloned
    // if this didn't happen, we don't want to run
    if (fs.existsSync(process.cwd() + process.env.OUT_DIR)) {
        if (process.env.cookie && process.env.xApigeeClassicCsrf) {
            resetRuntimeVars();
            scheduleCsrfRefreshAndExecute();
            countDownDays();
            cb(`Starting from ${process.env.from} going back ${process.env.days} days`);
        } else {
            errcb('No Authentication provided');
        }
    } else {
        errcb(`${process.cwd() + process.env.OUT_DIR} doesn't exist. Provide git credentials first.`);
    }
}

const stop = (cb, errcb) => {
    shouldStopRequested = true;
    cb('Should stop requested');
}

function resetRuntimeVars() {
    errorCount = 0;
    authMailSent = false;
    shouldStopRequested = false;
}

async function countDownDays() {
    const startDate = moment(process.env.from);
    for (let currentDate = moment(startDate); startDate.diff(currentDate, 'days') <= process.env.days; currentDate.subtract(1, 'days')) {
        if (shouldStop()) {
            break;
        }
        await iterateOverDayHours(currentDate);
    }
    shouldStopRequested = true;
    log.info('Finished countDownDays()');
    const cb = (msg) => {
        log.info(msg);
    }
    const commitResult = commitAll(log);
    log.info({ commitResult });
    if (commitResult) {
        processOut(cb);
    } else {
        cb('Could not commit. Check server logs.');
    }
}

async function iterateOverDayHours(currentDate) {
    for (let i = 0; i <= 23; i++) {
        const twoDigitHour = i.toString().padStart(2, 0);

        const hourSegments = [
            {
                from: `+${twoDigitHour}:00:00~`,
                to: `+${twoDigitHour}:19:59`
            },
            {
                from: `+${twoDigitHour}:20:00~`,
                to: `+${twoDigitHour}:39:59`
            },
            {
                from: `+${twoDigitHour}:40:00~`,
                to: `+${twoDigitHour}:59:59`
            }
        ];

        for (let segment of hourSegments) {
            try {
                if (!fs.existsSync(fileNameWithPath(currentDate, segment))) {
                    if (!shouldStop()) {
                        let wasSucccessful = false;
                        do {
                            const sleepTime = randomMilliseconds();
                            // await asyncFunctionDelay(fetch, sleepTime, currentDate, segment, cb);
                            wasSucccessful = await fetch(currentDate, segment);
                            log.info(`wasSuccessful ${wasSucccessful}`);
                            log.info(`sleeping for ${sleepTime} executing at ${moment().add(sleepTime, 'milliseconds').format('hh:mm:ss')}`);
                            await waitFor(sleepTime);
                        } while (!wasSucccessful && !shouldStop())
                    }
                } else {
                    // log.info(`skipping ${fileNameWithPath(currentDate, segment)}`);
                }
            } catch (err) {
                log.error(JSON.stringify(err))
            }
        }
    }
}

function waitFor(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const fetch = async (currentDate, segment) => {
    log.info(`fetching ${currentDate.format('DD-MM-YYYY')} ${JSON.stringify(segment)}`);

    const reFormattedCurrentDate = currentDate.format('MM%2FDD%2FYYYY');
    const dateTimeFromTo = reFormattedCurrentDate + segment.from + reFormattedCurrentDate + segment.to;

    const url = `https://edgeui.apimanager.****/ws/proxy/organizations/internal/environments/production/stats/developer_app?_optimized=js&accuracy=100&filter=(apiproxy+eq+%27*-prod%27)&limit=14400&realtime=true&select=sum(message_count)%2F(60.00),sum(message_count)&sort=DESC&sortby=sum(message_count)%2F(60.00),sum(message_count)&timeRange=${dateTimeFromTo}&timeUnit=minute&tsAscending=true&tzo=60`;

    const headers = {
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9,de-DE;q=0.8,de;q=0.7",
        "cache-control": "no-cache",
        "pragma": "no-cache",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-apigee-classic-csrf": process.env.xApigeeClassicCsrf,
        "x-requested-with": "XMLHttpRequest",
        "cookie": process.env.cookie,
        "authority": "edgeui.apimanager.company.com",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4132.0 Safari/537.36",
        "referer": "https://edgeui.apimanager.company.com/platform/internal/analytics/v2/2b590c3d-9588-4639-89bd-32b67482279b",
        "accept-language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7"
    };

    const client = httpClient(headers);
    try {
        const response = await client.get(url);
        if (!(response && response.body)) {
            return false;
        }
        try {
            fs.writeFileSync(fileNameWithPath(currentDate, segment), response.body);
        } catch (error) {
            log.error(JSON.stringify(error));
            return false;
        }

        resetErrorCount();

        log.info(`fetched ${currentDate.format('DD-MM-YYYY')} ${JSON.stringify(segment)}`);

        return true;
    } catch (error) {
        if (error.message.includes('401') || error.message.includes('403')) {
            increaseErrorCount(error);
            refreshCsrfToken();
        } else {
            if (error && error.message) {
                log.error(`${error.message} at ${currentDate.format('DD-MM-YYYY')} ${JSON.stringify(segment)}`);
            } else {
                log.error(`${JSON.stringify(error)} at ${currentDate.format('DD-MM-YYYY')} ${JSON.stringify(segment)}`);
            }
        }
        return false;
    }
}

const sendMail = (error) => {
    if (!authMailSent) {
        const msg = {
            "error": error.message,
            "details": error.body ? JSON.parse(error.body) : '',
        };
        mailClient.sendEmail({
            "to": ["*"],
            "subject": "call-reports // server message",
            "text": JSON.stringify(msg),
            "html": JSON.stringify(msg)
        });
        log.info(msg);
        authMailSent = true;
    }
}

function resetErrorCount() {
    errorCount = 0;
}

function fileNameWithPath(currentDate, segment) {
    const fileNameDateTimeFormat = currentDate.format('YYYY-MM-DD') + segment.from + segment.to;
    const fileName = `${process.cwd() + process.env.OUT_DIR}${fileNameDateTimeFormat.replace(/:/g, '-').replace(/\+/g, '_')}.json`;
    return fileName;
}

const randomMilliseconds = () => {
    const min = parseInt(process.env.min || (20000)); // 20 seconds
    const max = parseInt(process.env.max || (40000));
    const rand = Math.floor(Math.random() * (max - min + 1)) + min;
    return rand;
}

const httpClient = (reqHeaders) => {
    const proxy = process.env.https_proxy;
    const client = got.extend({
        headers: reqHeaders,
        agent: {
            https: tunnel.httpsOverHttp({
                proxy: proxy ? {
                    host: proxy.split('://')[1].split(':')[0],
                    port: proxy.split(':')[2]
                } : null
            })
        },
        // https: {
        //     rejectUnauthorized: false
        // },
        timeout: 60000
    });
    return client;
}

const scheduleCsrfRefreshAndExecute = () => {
    // schedule recursively and then run once
    if (!shouldStopRequested)
        asyncFunctionDelay(scheduleCsrfRefreshAndExecute, (2 * 60 * 1000)); // every 2mins

    refreshCsrfToken();
}

function refreshCsrfToken() {
    if (shouldStop())
        return;

    const headers = {
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        "accept-language": "en-US,en;q=0.9,de-DE;q=0.8,de;q=0.7",
        "cache-control": "max-age=0",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "cookie": process.env.cookie,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4132.0 Safari/537.36",
        "referrer": "https://authenticator.pingone.eu/",
        "referrerPolicy": "origin",
        "mode": "cors"
    };
    const client = httpClient(headers);

    const url = 'https://edgeui.apimanager.company.com/platform/internal/apis';
    client.get(url)
        .then(response => {
            /*
            /(csrfToken:\s")(.+)("\,)/m
                //m: multiline, make sure it's NOT g for global
                (csrfToken:\s"): selectgroup #1, matches 'csrfToken: "'
                (.+): selectgroup #2, matches everything of at least 1 length
                ("\,): selectgroup #3, matches '",'
                example:
                    0: "csrfToken: "CLlECKxaRK/pxwxkNP9Ma6T0ZFo=:1612382937261","
                    1: "csrfToken: ""
                    2: "CLlECKxaRK/pxwxkNP9Ma6T0ZFo=:1612382937261"
                    3: "","
            */
            const csrfRegex = /(csrfToken:\s")(.+)("\,)/m;
            process.env.xApigeeClassicCsrf = response.body.match(csrfRegex)[2];
            log.info('new csrf token set');
            log.info(`Has set-cookie: ${response.headers.hasOwnProperty('set-cookie')}`);
            if (response.headers.hasOwnProperty('set-cookie')) {
                refreshCookies(response.headers);
            }
            resetErrorCount();
        })
        .catch(error => {
            log.error(JSON.stringify(error));
            increaseErrorCount(error);
        });
}

function increaseErrorCount(error) {
    errorCount++;
    log.info(`errorCount: ${errorCount}`);
    if (errorCount > 4) {
        sendMail(error);
    }
}

function refreshCookies(newHeaders) {
    const old = process.env.cookie; // only used during debugging
    // split old cookies into map
    const oldCookiesMap = new Map();
    process.env.cookie.split(';').forEach(cookie => {
        const name = cookie.trim().split('=')[0]; // trim for key-comparisons
        oldCookiesMap.set(name, cookie);
    });
    // process new cookies
    const setCookies = newHeaders['set-cookie'];
    setCookies.forEach(setCookie => {
        const cookie = setCookie.split(';')[0];
        const name = cookie.split('=')[0]; //don't trim to preserve white-space

        // replace old with new
        if (oldCookiesMap.has(name)) {
            oldCookiesMap.set(name, cookie);
        }
    });
    // join cookies
    let newCookies = '';
    for (let value of oldCookiesMap.values()) {
        if (newCookies === '') {
            newCookies = value;
        } else {
            newCookies = `${newCookies};${value}`;
        }
    }
    // set it
    process.env.cookie = newCookies;
    log.info('set-cookie received & processed.');
    // diff
    // log.info('-------OLD----------');
    // log.info(old);
    // log.info('-------NEW----------');
    // log.info(process.env.cookie);
}

module.exports = { start, stop, randomMilliseconds, scheduleCsrfRefreshAndExecute };
