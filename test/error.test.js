const TCPBase = require('../');
const server = require('./support/server_immidiate_end');

describe('test/error.test.js', () => {
  class Client extends TCPBase {
    constructor(options) {
      Object.assign(options, {
        headerLength: 8,
        heartbeatInterval: 3000,
      });

      super(options);
    }

    getBodyLength(header) {
      return header.readInt32BE(0);
    }

    decode(buf, header) {
      let data;
      if (buf) {
        data = JSON.parse(buf);
      }
      return {
        id: header.readInt32BE(4),
        data,
      };
    }

    get heartBeatPacket() {
      return makeRequest(1).data;
    }
  }

  function makeRequest(id, content, oneway) {
    const header = Buffer.alloc(8);
    header.fill(0);
    const body = Buffer.from(JSON.stringify(content || {
      id,
      message: 'hello',
    }));
    header.writeInt32BE(body.length, 0);
    header.writeInt32BE(id, 4);
    return {
      id,
      oneway,
      data: Buffer.concat([ header, body ]),
    };
  }

  describe('should not throw uncaughtExeception', () => {
    it('when socket has been destroyed', done => {
      server.start(9090, () => {
        const client = new Client({
          host: '127.0.0.1',
          port: 9090,
        });

        client.once('connect', () => {
          client.send({ id: 'foo', data: 'bar1' });
          server.close();
          client.send({ id: 'foo', data: 'bar2' });
        });
        client.on('error', err => err);
        client.on('close', () => console.log('close'));
        setTimeout(done, 5000);
      });
    });

    it('when receive error multiple times', done => {
      server.start(9090, () => {
        const client = new Client({
          host: '127.0.0.1',
          port: 9090,
        });

        client.once('connect', () => {
          server.close();
          const error = new Error('ECONNRESET');
          error.code = 'ECONNRESET';
          client._socket && client._socket.emit('error', error);
          client._socket && client._socket.emit('error', error);
        });
        client.on('error', err => err);
        client.on('close', () => console.log('close'));
        setTimeout(done, 5000);
      });
    });
  });
});
