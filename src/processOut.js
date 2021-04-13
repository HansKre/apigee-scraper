var fs = require('fs');

var consumers = JSON.parse(fs.readFileSync("./src/consumers.json", 'utf8'));

/*
The apigee data has a TimeUnit-property:

"Response" : {
    "TimeUnit" : [ 1612556400000, 1612556460000, 1612556520000, 1612556580000, 1612556640000, 1612556700000, 1612556760000, 1612556820000, 1612556880000, 1612556940000, 1612557000000, 1612557060000, 1612557120000, 1612557180000, 1612557240000, 1612557300000, 1612557360000, 1612557420000, 1612557480000, 1612557540000 ],

In the TimeUnit-Array, minute-values are provided and represent the time-range of the response.
In our case, all requests are 20min slots from same hour (and hence, same day).

For example:
const date = new Date(1612347480000)
console.log(date);
// Wed Feb 03 2021 11:18:00 GMT+0100 (Mitteleuropäische Normalzeit)
date.getYear() + 1900
// 2021
date.getMonth() + 1
// 2
date.getDate()
// 3
date.getHours()
// 11
date.getMinutes()
// 18
*/

class Hour {
    constructor(name) {
        this.type = 'hour';
        this.name = name;
        let _data = 0;
        this.add = (value) => {
            if (typeof value === 'number') {
                _data += value;
            } else {
                throw TypeError('Added value must be a number');
            }
        }
        this.getData = function () { return _data };
    }
    toString() {
        return JSON.stringify({
            'name': this.name,
            'type': this.type,
            'data': this.getData()
        });
    }
}

class Day {
    constructor(name) {
        this.type = 'day';
        this.name = name;
        const _data = new Map();
        this.getData = function () { return Array.from(_data.values()) };
        this.sum = function () { return this.getData().reduce((acc, curr) => acc + curr.getData(), 0) }
        this.getHour = (hourInteger) => {
            if (!_data.has(hourInteger)) {
                _data.set(hourInteger, new Hour(hourInteger));
            }
            return _data.get(hourInteger);
        }
    }
    toString() {
        return JSON.stringify({
            'name': this.name,
            'type': this.type,
            'data': this.getData().map(hour => JSON.parse(hour.toString())),
            'sum': this.sum()
        });
    }
}

class Month {
    constructor(name) {
        this.type = 'month';
        this.name = name;
        const _data = new Map();
        this.getData = function () { return Array.from(_data.values()) };
        this.sum = function () { return this.getData().reduce((acc, curr) => acc + curr.sum(), 0) }
        this.getDay = (dayInteger) => {
            if (!_data.has(dayInteger)) {
                _data.set(dayInteger, new Day(dayInteger));
            }
            return _data.get(dayInteger);
        }
    }
    toString() {
        return JSON.stringify({
            'name': this.name,
            'type': this.type,
            'data': this.getData().map(day => JSON.parse(day.toString())),
            'sum': this.sum()
        });
    }
}

class Year {
    constructor(name) {
        this.type = 'year';
        this.name = name;
        const _data = new Map();
        this.getData = function () { return Array.from(_data.values()) };
        this.sum = function () { return this.getData().reduce((acc, curr) => acc + curr.sum(), 0) }
        this.getMonth = (monthInteger) => {
            if (!_data.has(monthInteger)) {
                _data.set(monthInteger, new Month(monthInteger));
            }
            return _data.get(monthInteger);
        }
        /**
         * @function addValueForDate Lazyly creates the date-time schema and populates it with data. Lazy means: no data = no entry = hole.
         * @param  {int} value {description}
         * @param  {Date} date  {description}
         * @return {void} {description}
         */
        this.addValueForDate = (value, date) => {
            const monthInteger = date.getMonth() + 1;
            const month = this.getMonth(monthInteger);

            const dayInteger = date.getDate();
            const day = month.getDay(dayInteger);

            const hourInteger = date.getHours();
            const hour = day.getHour(hourInteger);

            hour.add(value);
        }
    }
    toString() {
        return JSON.stringify({
            'name': this.name,
            'type': this.type,
            'data': this.getData().map(month => JSON.parse(month.toString())),
            'sum': this.sum()
        });
    }
}

const processOut = (cb) => {
    fs.readdir("out", function (err, fileNames) {
        if (err) {
            console.log(err);
        }

        const consumers = [];
        // parse files and aggregate
        for (let fileName of fileNames) {
            const pathToFile = './out/' + fileName;
            try {
                // get file content
                const fileContent = fs.readFileSync(pathToFile, 'utf8');
                const fileContentJson = JSON.parse(fileContent);

                // extract counts per consumer
                for (let d of fileContentJson.Response.stats.data) {
                    // calc sum
                    const sumUpValues = (accumulator, currentValue) => accumulator + currentValue;
                    const sumOfValues = d.metric[0].values.reduce(sumUpValues);

                    // do we have the consumer already?
                    const consumerId = d.identifier.values[0];
                    let consumer = consumers.find(consumer => consumer.name === consumerId);
                    if (!consumer) {
                        consumer = {
                            'name': consumerId
                        }
                        consumers.push(consumer);
                    }
                    let years;
                    if (consumer.hasOwnProperty('years')) {
                        years = consumer.years;
                    } else {
                        consumer.years = [];
                        years = consumer.years;
                    }

                    // extract time
                    // assumption: every entry in the Response.TimeUnit-Array is
                    // from same hour and same day, so it's enough to processOut one value only
                    const date = new Date(fileContentJson.Response.TimeUnit[0]);
                    const yearInteger = date.getYear() + 1900;
                    let year = years.find(year => year.name === yearInteger);
                    if (!year) {
                        year = new Year(yearInteger);
                        years.push(year);
                    }
                    year.addValueForDate(sumOfValues, date);

                }
            } catch (err) {
                console.log(err, pathToFile);
            }
        }

        const json =
            consumers.map(consumer => {
                return {
                    'name': consumerNameForId(consumer.name),
                    'years': consumer.years.map(year => JSON.parse(year.toString()))
                }
            });

        const outFile = './reports/out.json';
        fs.writeFileSync(outFile, JSON.stringify(json));

        console.log('Outputted to', outFile);
        if (cb)
            cb('out-dir processed successfully and created new ./reports/out.json');
    });
}

var consumerNameForId = (appId) => {
    let name = appId;
    for (let consumer of consumers.data) {
        if (appId == consumer.apigeeName) {
            name = consumer.name;
        }
    }
    return name;
}

// to call it from terminal: node /src/processOut.js
// processOut();

// make it available for imports
module.exports = { processOut };