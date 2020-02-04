const amqp = require('amqp-connection-manager')

const QUEUE_NAME = 'face_recog'
const EXCHANGE_NAME = 'message';

// Handle an incomming message.
const onMessage = data => {
    var message = JSON.parse(data.content.toString());
    console.log("subscriber: got message", message);
    channelWrapper.ack(data);
}

// Create a connetion manager
const connection = amqp.connect(['amqp://guest:guest@localhost:5672'], { reconnectTimeInSeconds: 1, heartbeatIntervalInSeconds: 1 });
connection.on('connect', () => console.log('Connected!'));
connection.on('disconnect', err => console.log('Disconnected.'));

// Set up a channel listening for messages in the queue.
var channelWrapper = connection.createChannel({
    setup: channel =>
        // `channel` here is a regular amqplib `ConfirmChannel`.
        Promise.all([
            channel.assertQueue(QUEUE_NAME, { exclusive: true, autoDelete: true }),
            channel.assertExchange(EXCHANGE_NAME, 'topic'),
            channel.prefetch(1),
            channel.bindQueue(QUEUE_NAME, EXCHANGE_NAME, '#'),
            channel.consume(QUEUE_NAME, onMessage)
        ])
});

channelWrapper.waitForConnect()
.then(function() {
    console.log("Listening for messages");
});