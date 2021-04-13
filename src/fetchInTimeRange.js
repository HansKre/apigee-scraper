// TODO: this module is not finished!
// below code has been refactored and separated from fetch.js
// to clean up and simplify

const fetchBetween = async (from, to, cb) => {
    if (process.env.cookie && process.env.xApigeeClassicCsrf) {
        await iterateOverDays(from, to, cb);
    } else {
        cb('No Authentication provided');
    }
}

async function iterateOverDays(from, to, cb) {
    const fromDate = moment(from, INPUT_DATE_FORMAT, true);
    const toDate = moment(to, INPUT_DATE_FORMAT, true);

    if (fromDate.isValid() && toDate.isValid()) {
        for (let currentDate = fromDate; currentDate.diff(toDate, 'days') <= 0; currentDate.add(1, 'days')) {
            if (!isError())
                await iterateOverDayHours(currentDate, cb);
        }
    } else {
        cb('Invalid date provided');
    }
}

module.exports = { fetchBetween };