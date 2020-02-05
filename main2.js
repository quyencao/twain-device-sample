const amqp = require('amqplib');
const forever = require('forever-monitor');
const Ajv = require('ajv');
const fs = require('fs');

const Monitor = forever.Monitor;
const ajv = new Ajv({ allErrors: true });
const schema = {
    "type": "object",
    "properties": {
        "id": {
            "type": "string"
        },
        "host": {
            "type": "string"
        }
    },
    "required": ["id", "host"]
};
const validate = ajv.compile(schema);
const config = readFileSync('/twain/config/config.json');

if (!validate(config)) {
    console.log("Invalid config file");
    process.exit(0);
}

const QUEUE = config.id || 'device_y';
const opts = {
    // cert: fs.readFileSync('../etc/client/cert.pem'),
    // key: fs.readFileSync('../etc/client/key.pem'),
    // cert and key or
    // pfx: fs.readFileSync('../etc/client/keycert.p12'),
    // passphrase: 'MySecretPassword',
    // ca: [fs.readFileSync('../etc/testca/cacert.pem')]
};

let downloadModel = undefined;
let downloadSource = undefined;
let install = undefined;
let run = undefined;

function readFileSync (file, options) {
    options = options || {}
  
    try {
      let content = fs.readFileSync(file, options);
      return JSON.parse(content, options.reviver);
    } catch (err) {
      return null
    }
}

amqp.connect({ 
    hostname: config.host || 'localhost', 
    port: 5672,
    username: 'guest',
    password: 'guest',
    vhost: '/',
    protocol: 'amqp'
}, opts).then(function(conn) {
  process.once('SIGINT', function() { conn.close(); });

  return conn.createChannel().then(function(ch) {

    let ok = ch.assertQueue(QUEUE, { durable: false });

    ok = ok.then(function(_qok) {
      return ch.consume(QUEUE, function(data) {
        const message = JSON.parse(data.content.toString());

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
    
                install = new Monitor('install.sh', {
                    max: 1,
                    killTree: true,
                    pidFile: '/var/run/install.pid',
                    command: 'bash',
                    sourceDir: '/twain/code',
                    env: { 
                        SOURCE_DIRECTORY: '/twain/code',
                        MODEL_DIRECTORY: '/twain/model'
                    },
                    cwd: '/twain/code'
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
                        run = new Monitor('main.py', {
                            max: 1,
                            killTree: true,
                            pidFile: '/var/run/run.pid',
                            command: 'python3',
                            sourceDir: '/twain/code',
                            env: { 
                                SOURCE_DIRECTORY: '/twain/code',
                                MODEL_DIRECTORY: '/twain/model'
                            },
                            cwd: '/twain/code'
                        });
            
                        run.on('start', () => {
                            console.log('run START');
                        });
            
                        run.on('stdout', (data) => {
                            console.log('run DATA', data.toString());

                            ch.publish('', 'face_recog', data);
                            // channelWrapper.publish('message', 'face_recog', data)
                            // ch.publish('message', 'face_recog', data)
                            //     .then(() => {
                            //         console.log('Message sent')
                            //     })
                            //     .catch(() => {
                            //         console.log("Message rejected")
                            //     });
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

      }, { noAck: true });
    });

    return ok.then(function(_consumeOk) {

        run = new Monitor('main.py', {
            max: 1,
            killTree: true,
            pidFile: '/var/run/run.pid',
            command: 'python3',
            sourceDir: '/twain/code',
            env: { 
                SOURCE_DIRECTORY: '/twain/code',
                MODEL_DIRECTORY: '/twain/model'
            },
            cwd: '/twain/code'
        });

        run.on('start', () => {
            console.log('run START');
        });

        run.on('stdout', (data) => {
            console.log('run DATA', data.toString());
            ch.publish('', 'face_recog', data);
        });

        run.on('error', (error) => {
            console.log('run ERROR', error);
        });
    
        run.on('exit:code', (code) => {
            console.log('run exit', code);
            run = undefined;
        });

        run.start();  

        console.log(' [*] Waiting for messages. To exit press CTRL+C');
    });

  });
}).catch(console.warn);