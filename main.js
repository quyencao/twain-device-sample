const amqp = require('amqp-connection-manager');
const forever = require('forever-monitor');
const Monitor = forever.Monitor;

const QUEUE_NAME = 'device_y';
const EXCHANGE_NAME = 'message';

let downloadModel = undefined;
let downloadSource = undefined;
let install = undefined;
let run = undefined;

// Handle an incomming message.
const onMessage = data => {
    const message = JSON.parse(data.content.toString());
    console.log("subscriber: got message", message);
    // channelWrapper.ack(data);

    const command = message.command;

    switch(command) {
        case 'model':
            if(downloadModel) {
                downloadModel.kill();
            }
        
            downloadModel = new Monitor('download.js', {
                max: 1,
                killTree: true,
                pidFile: '/var/run/downloadmodel.pid',
                env: { 
                    directory: '/twain/model',
                    tmp_directory: '/twain/tmp/model',
                    url: message.data.url,
                    filename: 'model.zip'
                }
            });

            downloadModel.on('start', () => {
                console.log('DOWNLOAD MODEL START');
            });

            downloadModel.on('stdout', (data) => {
                console.log('DOWNLOAD MODEL DATA', data.toString());
            });

            downloadModel.on('error', (error) => {
                console.log('DOWNLOAD MODEL ERROR', error);
            });
        
            downloadModel.on('exit:code', (code) => {
                console.log('DOWNLOAD EXIT!!!!', code);
                downloadModel = undefined;
            })
        
            downloadModel.start();

            break;
        case 'source':
            if(downloadSource) {
                downloadSource.kill();
            }
        
            downloadSource = new Monitor('download.js', {
                max: 1,
                killTree: true,
                pidFile: '/var/run/downloadsource.pid',
                env: { 
                    directory: '/twain/code',
                    tmp_directory: '/twain/tmp/code',
                    url: message.data.url,
                    filename: 'source.zip'
                }
            });

            downloadSource.on('start', () => {
                console.log('DOWNLOAD SOURCE START');
            });

            downloadSource.on('stdout', (data) => {
                console.log('DOWNLOAD SOURCE DATA', data.toString());
            });

            downloadSource.on('error', (error) => {
                console.log('DOWNLOAD SOURCE ERROR', error);
            });
        
            downloadSource.on('exit:code', (code) => {
                console.log('DOWNLOAD EXIT!!!!', code);

                downloadSource = undefined;
            })
        
            downloadSource.start();

            break;
        case 'run':
            if (install) {
                install.kill();
            }

            if (run) {
                run.kill();
            }

            install = new Monitor('/twain/code/install.sh', {
                max: 1,
                killTree: true,
                pidFile: '/var/run/install.pid',
                command: 'bash',
                env: { 
                    SOURCE_DIRECTORY: '/twain/code',
                    MODEL_DIRECTORY: '/twain/model'
                }
            });

            install.on('start', () => {
                console.log('install START');
            });

            install.on('stdout', (data) => {
                console.log('install DATA', data.toString());
            });

            install.on('error', (error) => {
                console.log('install ERROR', error);
            });
        
            install.on('exit:code', (code) => {
                console.log('install EXIT!!!!', code);

                install = undefined;

                if (code === 0) {
                    run = new Monitor('/twain/code/main.py', {
                        max: 1,
                        killTree: true,
                        pidFile: '/var/run/run.pid',
                        command: 'python3',
                        env: { 
                            SOURCE_DIRECTORY: '/twain/code',
                            MODEL_DIRECTORY: '/twain/model'
                        }
                    });
        
                    run.on('start', () => {
                        console.log('run START');
                    });
        
                    run.on('stdout', (data) => {
                        console.log('run DATA', data.toString());
                        // channelWrapper.publish('message', 'face_recog', data)
                        channelWrapper.publish('message', 'face_recog', data)
                            .then(() => {
                                console.log('Message sent')
                            })
                            .catch(() => {
                                console.log("Message rejected")
                            });
                    });
        
                    run.on('error', (error) => {
                        console.log('run ERROR', error);
                    });
                
                    run.on('exit:code', (code) => {
                        console.log('run exit', code);
                        run = undefined;
                    });

                    run.start();
                }
            })
        
            install.start();

            break;
        default:
            break;
    }
}

// Create a connetion manager
const connection = amqp.connect(['amqp://guest:guest@localhost:5672'], { reconnectTimeInSeconds: 1, heartbeatIntervalInSeconds: 1 });

connection.on('connect', () => console.log('Connected!'));

connection.on('disconnect', err => console.log('Disconnected...'));

// Set up a channel listening for messages in the queue.
const channelWrapper = connection.createChannel({
    setup: channel =>
        // `channel` here is a regular amqplib `ConfirmChannel`.
        Promise.all([
            channel.assertQueue(QUEUE_NAME, { exclusive: true, autoDelete: true, noAck: true }),
            channel.assertExchange(EXCHANGE_NAME, 'topic'),
            // channel.prefetch(1),
            channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, '#'),
            channel.consume(QUEUE_NAME, onMessage)
        ])
});

channelWrapper.waitForConnect()
    .then(function() {
        console.log("Listening for messages");
    });
