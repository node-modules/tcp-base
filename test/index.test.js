'use strict';

const mm = require('mm');
const assert = require('assert');
const pedding = require('pedding');
const TCPBase = require('../');
const server = require('./support/server');

describe('test/index.test.js', () => {

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

  class Client2 extends Client {
    constructor(options) {
      Object.assign(options, {
        headerLength: 0,
        needHeartbeat: false,
      });

      super(options);
    }

    getHeader() {
      return this.read(8);
    }
  }

  class Client3 extends Client2 {
    decode() {
      throw new Error('mock error');
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

  let client;
  before(done => {
    server.start(12201, err => {
      if (err) {
        return done(err);
      }
      client = new Client({
        host: '127.0.0.1',
        port: 12201,
      });

      client.ready(done);
    });
  });

  afterEach(mm.restore);

  after(() => {
    client.close();
    server.close();
  });

  it('client should be ok', () => {
    assert(client.isOK);
  });

  it('should get address ok', () => {
    assert(client.address === '127.0.0.1:12201');
  });

  it('should send request ok', done => {
    client.send(makeRequest(1), (err, res) => {
      assert(!err);
      assert.deepEqual(res, {
        id: 1,
        message: 'hello',
      });
      done();
    });
  });

  it('should send thunk ok', function* () {
    const res = yield client.sendThunk(makeRequest(2));
    assert.deepEqual(res, {
      id: 2,
      message: 'hello',
    });
  });

  it('should send oneway ok', function* () {
    yield client.sendThunk(makeRequest(3, {
      id: 3,
      noResponse: true,
    }, true));
    assert(client._invokes.size === 0);
  });

  it('should emit error if connect timeout', done => {
    const client = new Client({
      host: '127.0.0.1',
      port: 12000,
    });
    client.on('error', err => {
      assert(err);
      assert(err.message.includes('connect ECONNREFUSED 127.0.0.1:12000'));
      done();
    });
  });

  it('should emit close if socket is destroyed', done => {
    let client = new Client({
      host: '127.0.0.1',
      port: 12201,
    });

    client.on('close', () => {
      client = new Client({
        host: '127.0.0.1',
        port: 12201,
      });
    });

    client._socket.destroy();

    setTimeout(() => {
      client.send(makeRequest(1), (err, res) => {
        assert(!err);
        assert.deepEqual(res, {
          id: 1,
          message: 'hello',
        });
        done();
      });
    }, 1000);
  });

  it('should emit close in the same tick', function* () {
    let client = new Client({
      host: '127.0.0.1',
      port: 12201,
    });

    client.on('close', () => {
      client = new Client({
        host: '127.0.0.1',
        port: 12201,
      });
    });

    client.close();

    const res = yield client.sendThunk(makeRequest(2));
    assert.deepEqual(res, {
      id: 2,
      message: 'hello',
    });
  });

  it('should emit error if socket has been closed', done => {
    const client = new Client3({
      host: '127.0.0.1',
      port: 12201,
    });

    client.close();

    client.send(makeRequest(1), err => {
      assert(err);
      assert(err.name === 'SocketCloseError');
      done();
    });
  });

  it('should reconnect after socket was closed and invoke ok', done => {
    const client = new Client({
      host: '127.0.0.1',
      port: 12201,
      reConnectTimes: 1,
    });

    client.close();

    client.send(makeRequest(1), err => {
      assert(!err);
      done();
    });
  });

  it('should reconnect after packet parsed error and invoke ok', done => {
    const client = new Client3({
      host: '127.0.0.1',
      port: 12201,
      reConnectTimes: 5,
    });

    client.on('error', () => {
      client.decode = (buf, header) => {
        const data = JSON.parse(buf);
        return {
          id: header.readInt32BE(4),
          data,
        };
      };

      client.send(makeRequest(1), err => {
        assert(!err);
        done();
      });
    });


    client.send(makeRequest(1), err => {
      assert(err.message === 'mock error');
    });
  });

  it('should reconnect and emit error if still can\'t connect', done => {
    done = pedding(2, done);
    const client = new Client({
      host: '127.0.0.1',
      port: 12200,
      reConnectTimes: 5,
    });

    client.on('error', err => {
      console.log(err);
    });

    client.on('close', () => {
      done();
    });

    client.send(makeRequest(1), err => {
      assert(err);
      done();
    });
  });

  it('should emit error if parse header error', done => {
    done = pedding(2, done);

    const client = new Client3({
      host: '127.0.0.1',
      port: 12201,
    });

    client.on('error', err => {
      assert(err);
      assert(err.message === 'mock error');
      done();
    });

    client.send(makeRequest(1), err => {
      assert(err);
      assert(err.message === 'mock error');
      done();
    });
  });

  it('should emit error if parse body error', done => {
    done = pedding(2, done);

    const client = new Client3({
      host: '127.0.0.1',
      port: 12201,
    });

    client.on('error', err => {
      assert(err);
      assert(err.message === 'mock error');
      done();
    });

    client.send(makeRequest(1), err => {
      assert(err);
      assert(err.message === 'mock error');
      done();
    });
  });

  it('should process request timeout well', done => {
    client.send(makeRequest(4, {
      id: 4,
      noResponse: true,
    }, false), err => {
      assert(err);
      assert(
        [ 'id' ].every(p => Object.prototype.hasOwnProperty.call(err.socketMeta, p))
      );
      assert(err.socketMeta.writeSuccess);
      assert(err.message === 'Server no response in 3000ms, address#127.0.0.1:12201');
      done();
    });
  });

  it('should wait for drain if buffer is full', function* () {
    const queue = [];
    const content = require('../package.json');
    for (let i = 5; i < 10000; i++) {
      const req = makeRequest(i, {
        id: i,
        content,
      });
      req.timeout = 10000;
      queue.push(client.sendThunk(req));
    }
    yield queue;
  });

  it('should clean all invoke if client is close', done => {
    const cli = new Client({
      host: '127.0.0.1',
      port: 12201,
    });
    cli.ready()
      .then(() => {
        cli.send(makeRequest(2, {
          id: 2,
          timeout: 2000,
        }), err => {
          assert(err);
          assert(err.name === 'SocketCloseError');
        });
        cli._queue.push([ makeRequest(1, {
          id: 1,
          timeout: 2000,
        }), err => {
          assert(err);
          assert(err.name === 'SocketCloseError');
        } ]);
        cli.close();
      })
      .catch(err => done(err));
    cli.on('close', () => {
      assert(cli._invokes.size === 0);
      assert(cli._queue.length === 0);
      done();
    });
  });

  it('should override getHeader ok', function* () {
    const client = new Client2({
      host: '127.0.0.1',
      port: 12201,
    });
    yield client.ready();
    const res = yield client.sendThunk(makeRequest(1));
    assert.deepEqual(res, {
      id: 1,
      message: 'hello',
    });
  });

  it('should send heartbeat request', function(done) {
    const client = new Client({
      host: '127.0.0.1',
      port: 12201,
    });
    assert(client._heartbeatTimer);
    mm(client._socket, 'write', buf => {
      assert.deepEqual(buf, client.heartBeatPacket);
      done();
    });
  });

  it('should override sendHeartBeat', function(done) {
    class Client5 extends Client {
      sendHeartBeat() {
        this.send(makeRequest(10), (err, res) => {
          this.emit('heartbeat', res);
        });
      }
    }

    const client = new Client5({
      host: '127.0.0.1',
      port: 12201,
    });

    assert(client._heartbeatTimer);
    client.on('heartbeat', data => {
      assert(data.id === 10);
      client.close();
      done();
    });
  });

  it('should support concurrent', function* () {
    const concurrent = 3;

    class Client5 extends Client2 {
      constructor(options) {
        Object.assign(options, {
          concurrent,
        });
        super(options);
      }

      send(packet, callback) {
        assert(this._invokes.size <= concurrent);
        return super.send(packet, callback);
      }
    }

    const client = new Client5({
      host: '127.0.0.1',
      port: 12201,
    });
    const queue = [];
    for (let i = 0; i < 20000; i++) {
      const req = makeRequest(i);
      req.timeout = 10000;
      queue.push(client.sendThunk(req));
    }
    yield queue;
  });

  it('should send before ready', done => {
    const client = new Client({
      host: '127.0.0.1',
      port: 12201,
    });
    client.send(makeRequest(1), (err, res) => {
      assert(!err);
      assert.deepEqual(res, {
        id: 1,
        message: 'hello',
      });
      done();
    });
  });

  it('should process empty body ok', done => {
    const header = new Buffer(8);
    header.writeInt32BE(0, 0);
    header.writeInt32BE(1000, 4);
    const request = {
      id: 1000,
      oneway: false,
      data: header,
    };
    client.send(request, (err, res) => {
      assert(!err);
      assert(!res);
      done();
    });
  });

  it('should not emit PacketParsedError  if message is handled with error in event listener', done => {
    const listeners = process.listeners('uncaughtException');
    process.removeAllListeners('uncaughtException');

    const handle = err => {
      assert(err.message === 'responseError');
      process.removeAllListeners('uncaughtException');
      listeners.forEach(listener => {
        process.on('uncaughtException', listener);
      });
      done();
    };
    process.on('uncaughtException', handle);

    let first = false;
    client.on('response', () => {
      if (!first) {
        first = true;
        throw new Error('responseError');
      }
    });

    client.on('error', () => {
      assert(false, 'should not run');
    });

    client.send(makeRequest(1), err => {
      assert(!err);
    });
  });

  it('send response packet', done => {
    mm(client.options, 'concurrent', 1);
    // 1. send 正常请求,
    // 2. 连续 send oneway 请求.
    // 3. 验证 queue 的数量和队列的内容是否符合预期.
    done = pedding(4, done);

    const c0 = {
      id: 10,
      message: 'hello',
      timeout: 100,
    };

    const c1 = {
      id: 11,
      message: 'hello',
      timeout: 500,
    };

    const c2 = {
      id: 12,
      message: 'hello',
      timeout: 1000,
    };

    client.send(makeRequest(10, c0), (err, res) => {
      assert(!err);
      assert.deepEqual(res, c0);
      done();
    });

    client.send(makeRequest(11, c1), (err, res) => {
      assert(!err);
      assert.deepEqual(res, c1);
      done();
    });

    setTimeout(() => {
      // c1 目前已经在 queue 里面, 然后连续添加2个 oneway.
      client.send(makeRequest(15, {
        id: 5,
        oneway: true,
      }, true));

      client.send(makeRequest(16, {
        id: 6,
        oneway: true,
      }, true));

      client.send(makeRequest(17), (err, res) => {
        assert(!err);
        assert.deepEqual(res, { id: 17, message: 'hello' });
        done();
      });

      const queue = client._queue;
      assert(queue.length === 2);
      assert(queue[0][0].id === 12);
      assert(queue[1][0].id === 17);
    }, 600);

    client.send(makeRequest(12, c2), (err, res) => {
      assert(!err);
      assert.deepEqual(res, c2);
      done();
    });
  });

  it('should not emit PacketParsedError  if error occurred in callback function', done => {
    const listeners = process.listeners('uncaughtException');
    process.removeAllListeners('uncaughtException');

    const handle = err => {
      assert(err.message === 'callbackError');
      process.removeAllListeners('uncaughtException');
      listeners.forEach(listener => {
        process.on('uncaughtException', listener);
      });
      done();
    };
    process.on('uncaughtException', handle);

    client.on('error', () => {
      assert(false, 'should not run');
    });

    client.send(makeRequest(1), err => {
      assert(!err);
      throw new Error('callbackError');
    });
  });
});
