const simpleGit = require('simple-git');
const fs = require('fs');
const appEnv = require("cfenv").getAppEnv();

// const targetDir = process.env.OUT_DIR;
// process.cwd() folder where nodejs is called
// __dirname folder where the current script is located
const targetDir = process.cwd() + '/';
let log = process.env.logger;

const clone = async (_log) => {
    if (!log) log = _log;
    if (appEnv.url.includes('localhost'))
        return;
    if (!process.env.personalaccesstoken)
        return;

    // const dirCreated = createDirectories(targetDir);
    // if (dirCreated) {
    const git = createGitClient(targetDir);
    try {
        // 'git remote set-url origin https://user:token@github.com/scuzzlebuzzle/ol3-1.git'
        // 'git clone https://user:token@git.*.com/-cartography/calls-report.git'
        const initResult = await git.init();
        log.info(`git.js ~ clone ~ initResult ${JSON.stringify(initResult)}`);
        // after remote is set, it gets part of the git configuration of the server and does not have to be set again
        // it can be used during subsequent pushes and has to be reset only if the server gets restaged
        const addRemoteResult = await git.addRemote('origin', `https://callsreport:${process.env.personalaccesstoken}@git.company.com/cartography/calls-report.git`).catch(() => { /* ignore error */ });
        log.info(`git.js ~ clone ~ addRemoteResult ${JSON.stringify(addRemoteResult)}`);
        const fetchResult = await git.fetch();
        log.info(`git.js ~ clone ~ fetchResult ${JSON.stringify(fetchResult)}`);
        const addConfigResult = await git.addConfig('core.sparseCheckout', 'true');
        log.info(`git.js ~ clone ~ addConfigResult ${JSON.stringify(addConfigResult)}`);
        fs.writeFileSync(targetDir + '.git/info/sparse-checkout', 'out');
        const pullResult = await git.pull('origin', 'master');
        log.info(`git.js ~ clone ~ pullResult ${JSON.stringify(pullResult)}`);
    } catch (error) {
        console.log(error);
        console.log('logger', log);
        log.error(error);
    }
    // }
}

// Creates /tmp/a/apple, regardless of whether `/tmp` and /tmp/a exist.
const createDirectories = (pathname) => {
    try {
        fs.mkdirSync(targetDir, { recursive: true });
        return true;
    } catch (error) {
        log.error(error);
        return false;
    }
}

const commitAll = async (_log) => {
    if (!log) log = _log;
    const git = createGitClient(targetDir);
    try {
        const statusResult = await git.status();
        // { statusResult.not_added = [ '.config/configstore/update-notifier-npm.json', 'node_modules', 'out/2021-02-08_00-00-00~_00-19-59.json' ];
        log.info({ statusResult });
        log.info(`not_added ${statusResult.not_added}`);
        let addConfigResult = await git.addConfig('user.name', 'Calls');
        log.info({ addConfigResult });
        addConfigResult = await git.addConfig('user.email', 'hans@calls.com')
        log.info({ addConfigResult });
        const addResult = await git.add('out/');
        log.info({ addResult });
        const commitResult = await git.commit('Automatic /out commit');
        log.info({ commitResult });
        // push happens only if out/ dir has actual changes
        const pushResult = await git.push('origin', 'master');
        log.info({ pushResult });
        return true;
    } catch (error) {
        log.error(error);
        return false;
    }
}

function createGitClient(targetDir) {
    const options = {
        baseDir: targetDir,
        binary: 'git',
        maxConcurrentProcesses: 6,
    };

    const git = simpleGit(options);
    return git;
}

module.exports = { clone, commitAll };

// clone();
