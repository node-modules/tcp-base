'use strict';

const TCPBase = require('../lib/base');

/**
 * A Simple Protocol:
 *   (4B): request id
 *   (4B): body length
 *   ------------------------------
 *   body data
 */
class Client extends TCPBase {
  getHeader() {
    return this.read(8);
  }

  getBodyLength(header) {
    return header.readInt32BE(4);
  }

  decode(body, header) {
    return {
      id: header.readInt32BE(0),
      data: body,
    };
  }

  // heartbeat packet
  get heartBeatPacket() {
    return new Buffer([ 255, 255, 255, 255, 0, 0, 0, 0 ]);
  }
}

const client = new Client({
  host: '127.0.0.1',
  port: 8080,
});

const body = new Buffer('hello');
const data = new Buffer(8 + body.length);
data.writeInt32BE(1, 0);
data.writeInt32BE(body.length, 4);
body.copy(data, 8, 0);

client.send({
  id: 1,
  data,
  timeout: 5000,
}, (err, res) => {
  if (err) {
    console.error(err);
  }
  console.log(res.toString()); // should echo 'hello'
});
