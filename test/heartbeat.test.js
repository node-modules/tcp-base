'use strict';

const net = require('net');
const TCPBase = require('../');
const awaitEvent = require('await-event');
const sleep = require('mz-modules/sleep');

describe('test/heartbeat.test.js', () => {
  let id = 0;

  function makeRequest(data) {
    id++;
    const header = new Buffer(8);
    header.fill(0);
    const body = new Buffer(data || '');
    header.writeInt32BE(body.length, 0);
    header.writeInt32BE(id, 4);
    return {
      id,
      data: Buffer.concat([ header, body ]),
    };
  }

  class Client extends TCPBase {
    constructor(options) {
      Object.assign(options, {
        headerLength: 8,
      });
      super(options);
    }

    getBodyLength(header) {
      return header.readInt32BE(0);
    }

    decode(buf, header) {
      let data;
      if (buf) {
        data = buf.toString();
      }
      return {
        id: header.readInt32BE(4),
        data,
      };
    }

    get heartBeatPacket() {
      return makeRequest('heartbeat').data;
    }
  }

  let server;
  before(function* () {
    server = net.createServer(socket => {
      socket.on('data', data => {
        const len = data.readInt32BE(0);
        // 正常请求 hold 住不返回，只返回 heartbeat
        if (len) {
          socket.write(data);
        }
      });
    });
    server.listen(12201);
    yield awaitEvent(server, 'listening');
  });

  after(function* () {
    server.close();
    yield awaitEvent(server, 'close');
  });

  it('should heartbeat ok', function* () {
    const client = new Client({
      host: '127.0.0.1',
      port: 12201,
      heartbeatInterval: 1000,
      maxIdleTime: 5000,
    });

    yield sleep(1200);

    const timer = setInterval(() => {
      client.send(makeRequest());
    }, 500);

    yield Promise.race([
      awaitEvent(client, 'error'),
      sleep(5000),
    ]);

    clearInterval(timer);
    client.close();
  });
});
