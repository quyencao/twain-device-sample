const amqp = require('amqplib');
const forever = require('forever-monitor');

const Monitor = forever.Monitor;

class ProcessManager {
    constructor() {
        this.monitors = [];
    }

    start(script, options, events) {
        const monitor = new Monitor(script, options);
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

        monitor.on('stdout', function(data) {
            console.log(data.toString());
        });
    
        monitor.on('exit:code', function (code, signal) {
            console.log(`Process with uid ${monitor.uid} stop with code: ${code}`);

            if (events && events.onExit) {
                events.onExit(code);
            }
        });
    }
}

const QUEUE = 'device_y';
const opts = {
    // cert: fs.readFileSync('../etc/client/cert.pem'),
    // key: fs.readFileSync('../etc/client/key.pem'),
    // cert and key or
    // pfx: fs.readFileSync('../etc/client/keycert.p12'),
    // passphrase: 'MySecretPassword',
    // ca: [fs.readFileSync('../etc/testca/cacert.pem')]
};
const pm = new ProcessManager();

function connectRabbitMQ() {
    amqp.connect({ 
        hostname: 'localhost', 
        port: 5672,
        username: 'guest',
        password: 'guest',
        vhost: '/',
        protocol: 'amqp'
    }, opts).then(function(conn) {
      process.once('SIGINT', function() { conn.close(); });

      conn.on('close', function() {
        console.error('Lost connection to RabbitMQ.  Reconnecting in 2 seconds...');
        return setTimeout(connectRabbitMQ, 2 * 1000);
      });
    
      return conn.createChannel().then(function(ch) {
    
        let ok = ch.assertQueue(QUEUE, { durable: false });
    
        ok = ok.then(function(_qok) {
          return ch.consume(QUEUE, function(data) {
            const message = JSON.parse(data.content.toString());
    
            const command = message.command;
            const node = message.node;
    
            switch(command) {
                case 'DOWNLOAD_MODEL':
                    console.log('command', command);
        
                    break;
                case 'DOWNLOAD_SOURCE':
                    console.log('command', command);
                    
                    break;
                case 'STOP':
                    console.log('command', command);
                    pm.stopByUid(node);
                    break;
                case 'RUN':
                    console.log('command', command);
                    // const node = message.node;

                    const onExit = function(code) {
                        console.log('on exit install from outside', code);
                    
                        if (code === 0) {
                            pm.start('main.py', {
                                uid: node,
                                command: 'python',
                                max: 1,
                                killTree: true,
                                // sourceDir: '/home/quyencm/Desktop/test2/device-nodejs-mqtt/nodes',
                                env: { 
                                    SOURCE_DIRECTORY: '/twain/code',
                                    MODEL_DIRECTORY: '/twain/model',
                                },
                                cwd: `/home/quyencm/Desktop/test2/device-nodejs-mqtt/nodes/${node}`
                            });
                        }
                    }

                    pm.stopByUid(node);

                    pm.start('install.sh', {
                        uid: node,
                        command: 'bash',
                        max: 1,
                        killTree: true,
                        env: { 
                            directory: '/twain/model',
                            tmp_directory: '/twain/tmp/model'
                        },
                        cwd: `/home/quyencm/Desktop/test2/device-nodejs-mqtt/nodes/${node}`
                    }, { onExit })

                    break;
                default:
                    break;
            }
    
          }, { noAck: true });
        });
    
        return ok.then(function(_consumeOk) {
            console.log(' [*] Waiting for messages. To exit press CTRL+C');
        });
    
      });
    }).catch(function(err) {
        setTimeout(connectRabbitMQ, 2 * 1000);
        return console.log('Connection failed. Reconnecting in 2 seconds...');
    });
}

connectRabbitMQ();