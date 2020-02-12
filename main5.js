const amqp = require('amqplib');
const forever = require('forever-monitor');

const Monitor = forever.Monitor;

class ProcessManager {
    constructor() {
        this.monitors = [];
    }

    start(script, options, events) {
        const monitor = new forever.Monitor(script, options);
        this.monitors.push(monitor);
        this.logEvents(monitor, events);
        monitor.start();
    }

    findByUid(uid) {
        const filterMonitors = this.monitors.filter(m => m.uid === uid);

        if (filterMonitors.length > 0) {
            return filterMonitors;
        }

        return [];
    }

    // restartByUid(uid) {
    //     const monitor = this.findByUid(uid);
    //     if (monitor) {
    //         monitor.restart();
    //     }
    // }

    stopByUid(uid) {
        const monitors = this.findByUid(uid);

        if (monitors && monitors.length) {
            monitors.forEach(m => {
                if (m.running) {
                    m.stop();
                }
            });
        }
    }

    killByUid(uid) {
        const monitors = this.findByUid(uid);

        if (monitors && monitors.length) {
            monitors.forEach(m => {
                if (m.running) {
                    m.kill();
                }
            });
       }
    }

    logEvents(monitor, events) {
        monitor.on('watch:error', function (info) {
            console.error(info.message);
            console.error(info.error);
        });
        
        monitor.on('watch:restart', function (info) {
            forever.out.error('restarting script because ' + info.file + ' changed');
        });
    
        monitor.on('restart', function () {
            console.log(`Process with uid ${monitor.uid} restarted`);
        });
    
        monitor.on('exit:code', function (code, signal) {
            console.log(`Process with uid ${monitor.uid} stop with code: ${code}`);

            if (events && events.onExit) {
                events.onExit(code);
            }
        });
    }
}

const pm = new ProcessManager();

const onExit = function(code) {
    console.log('on end from outside');

    if (code === 0) {
        pm.start('main.py', {
            uid: '123',
            command: 'python',
            max: 1,
            killTree: true,
            sourceDir: '/twain/code',
            env: { 
                SOURCE_DIRECTORY: '/twain/code',
                MODEL_DIRECTORY: '/twain/model',
            },
            cwd: '/twain/code'
        });
    }

}

pm.start('install.sh', {
    uid: '123',
    command: 'bash',
    max: 1,
    killTree: true,
    env: { 
        directory: '/twain/model',
        tmp_directory: '/twain/tmp/model'
    },
    cwd: '/twain/code'
}, { onExit })

setTimeout(() => {
    pm.stopByUid('123');
}, 1000)