'use strict';

const assert = require('assert');
const pedding = require('pedding');
const TCPBase = require('../');
const server = require('./support/server_end');

describe('test/close_wait.test.js', () => {
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
    const header = new Buffer(8);
    header.fill(0);
    const body = new Buffer(JSON.stringify(content || {
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

  describe('end by server', () => {
    before(done => server.start(9600, true, done));
    after(() => server.close());

    it('should close if end by server', done => {
      const client = new Client({
        host: '127.0.0.1',
        port: 9600,
      });
      client.on('close', done);
    });
  });

  describe('long time no response', () => {
    before(done => server.start(9600, false, done));
    after(() => server.close());

    it('should close if long time no response', done => {
      done = pedding(done, 2);
      const client = new Client({
        host: '127.0.0.1',
        port: 9600,
      });
      client.on('close', done);
      client.on('error', err => {
        assert(err);
        assert(err.name === 'ServerNoResponseError');
        assert(/server 127.0.0.1:9600 no response in \d+ms, maybe the socket is end on the other side/i.test(err.message));
        done();
      });
    });
  });
});
