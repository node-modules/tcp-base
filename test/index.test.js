const mm = require('mm');
const os = require('os');
const path = require('path');
const assert = require('assert');
const pedding = require('pedding');
const { sleep } = require('mz-modules');
const server = require('./support/server');
const TCPBase = require('../');

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

  function makeRequest(id, content, oneway, tips) {
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
      tips,
      oneway,
      data: Buffer.concat([ header, body ]),
    };
  }

  let client;
  let client2;
  const sockPath = path.join(os.tmpdir(), `tcp-base-test-${Date.now()}.sock`);
  const port = 12211;
  before(done => {
    server.start(port, err => {
      if (err) {
        return done(err);
      }
      client = new Client({
        host: '127.0.0.1',
        port,
      });

      client.ready(() => {
        if (os.platform() === 'win32') {
          done();
        } else {
          server.start(sockPath, err => {
            if (err) {
              return done(err);
            }
            client2 = new Client({
              path: sockPath,
            });

            client2.ready(done);
          });
        }
      });
    });
  });

  afterEach(mm.restore);

  after(async () => {
    await client.close();
    await client.close();
    if (client2) {
      client2.close();
    }
    server.close();
  });

  it('client should be ok', () => {
    assert(client.isOK);
  });

  it('should get address ok', () => {
    assert(client.address === `127.0.0.1:${port}`);
  });

  it('should send request ok', done => {
    client.send(makeRequest(1), (err, res) => {
      assert.ifError(err);
      assert.deepEqual(res, {
        id: 1,
        message: 'hello',
      });
      done();
    });
  });

  if (client2) {
    it('client2 should be ok', () => {
      assert(client2.isOK);
    });
    it('client2 should send request ok', done => {
      client2.send(makeRequest(1001), (err, res) => {
        assert.ifError(err);
        assert.deepEqual(res, {
          id: 1001,
          message: 'hello',
        });
        done();
      });
    });
  }

  it('should send promise ok', async () => {
    const res = await client.sendPromise(makeRequest(2));
    assert.deepEqual(res, {
      id: 2,
      message: 'hello',
    });
  });

  it('should send oneway ok', async () => {
    await client.sendPromise(makeRequest(3, {
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
      port,
    });

    client.on('close', () => {
      client = new Client({
        host: '127.0.0.1',
        port,
      });
    });

    client._socket.destroy();

    setTimeout(() => {
      client.send(makeRequest(1), (err, res) => {
        assert.ifError(err);
        assert.deepEqual(res, {
          id: 1,
          message: 'hello',
        });
        done();
      });
    }, 1000);
  });

  // it('should emit close in the same tick', async () => {
  //   let client = new Client({
  //     host: '127.0.0.1',
  //     port,
  //   });

  //   client.on('close', () => {
  //     client = new Client({
  //       host: '127.0.0.1',
  //       port,
  //     });
  //   });

  //   client.close();

  //   const res = await client.sendPromise(makeRequest(2));
  //   assert.deepEqual(res, {
  //     id: 2,
  //     message: 'hello',
  //   });
  // });

  it('should emit error if socket has been closed', done => {
    const client = new Client3({
      host: '127.0.0.1',
      port,
    });

    client.close();

    client.send(makeRequest(1), err => {
      assert(err);
      assert(err.name === 'SocketCloseError');
      done();
    });
  });

  it('should emit error if parse header error', done => {
    done = pedding(2, done);

    const client = new Client3({
      host: '127.0.0.1',
      port,
    });

    client.on('error', err => {
      assert(err);
      assert(err.message.includes('mock error'));
      done();
    });

    client.send(makeRequest(1), err => {
      assert(err);
      assert(err.message.includes('mock error'));
      done();
    });
  });

  it('should emit error if parse body error', done => {
    done = pedding(2, done);

    const client = new Client3({
      host: '127.0.0.1',
      port,
    });

    client.on('error', err => {
      assert(err);
      assert(err.message.includes('mock error'));
      done();
    });

    client.send(makeRequest(1), err => {
      assert(err);
      assert(err.message.includes('mock error'));
      done();
    });
  });

  it('should process request timeout well', done => {
    client.send(makeRequest(4, {
      id: 4,
      noResponse: true,
    }, false), err => {
      assert(err);
      [ 'id', 'dataLength', 'bufferSize1', 'bufferSize2', 'startTime', 'endTime', 'writeSuccess' ]
        .forEach(p => {
          assert(err.socketMeta.hasOwnProperty(p));
        });
      assert(err.socketMeta.writeSuccess);
      assert(err.message === `Server no response in 3000ms, address#127.0.0.1:${port}`);
      done();
    });
  });

  it('should wait for drain if buffer is full', async () => {
    const queue = [];
    const content = require('../package.json');
    for (let i = 5; i < 10000; i++) {
      const req = makeRequest(i, {
        id: i,
        content,
      });
      req.timeout = 10000;
      queue.push(client.sendPromise(req));
    }
    await Promise.all(queue);
  });

  it('should clean all invoke if client is close', done => {
    const cli = new Client({
      host: '127.0.0.1',
      port,
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

  it('should override getHeader ok', async () => {
    const client = new Client2({
      host: '127.0.0.1',
      port,
    });
    await client.ready();
    const res = await client.sendPromise(makeRequest(1));
    assert.deepEqual(res, {
      id: 1,
      message: 'hello',
    });
  });

  it('should send heartbeat request', async () => {
    const client = new Client({
      host: '127.0.0.1',
      port,
    });
    await client.ready();
    await sleep(100);
    assert(client._heartbeatTimer);
    mm(client._socket, 'write', buf => {
      assert.deepEqual(buf, client.heartBeatPacket);
      client.emit('heartbeat');
    });
    await client.await('heartbeat');
    await client.close();
  });

  it('should override sendHeartBeat', async () => {
    const client = new Client({
      host: '127.0.0.1',
      port,
    });

    mm(client, 'sendHeartBeat', () => {
      client.send(makeRequest(10), (err, res) => {
        client.emit('heartbeat', res);
      });
    });

    await client.ready();
    await sleep(100);

    assert(client._heartbeatTimer);
    const heartbeat = await client.await('heartbeat');
    assert(heartbeat.id === 10);
    await client.close();
  });

  it('should support concurrent', async () => {
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
      port,
    });
    const queue = [];
    for (let i = 0; i < 20000; i++) {
      const req = makeRequest(i);
      req.timeout = 10000;
      queue.push(client.sendPromise(req));
    }
    await Promise.all(queue);
  });

  it('should send before ready', done => {
    const client = new Client({
      host: '127.0.0.1',
      port,
    });
    client.send(makeRequest(1), (err, res) => {
      assert.ifError(err);
      assert.deepEqual(res, {
        id: 1,
        message: 'hello',
      });
      done();
    });
  });

  it('should process empty body ok', done => {
    const header = Buffer.alloc(8);
    header.writeInt32BE(0, 0);
    header.writeInt32BE(1000, 4);
    const request = {
      id: 1000,
      oneway: false,
      data: header,
    };
    client.send(request, (err, res) => {
      assert.ifError(err);
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

    client.send(makeRequest(1), err => {
      assert.ifError(err);
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
      assert.ifError(err);
      assert.deepEqual(res, c0);
      done();
    });
    client.send(makeRequest(11, c1), (err, res) => {
      assert.ifError(err);
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
        assert.ifError(err);
        assert.deepEqual(res, { id: 17, message: 'hello' });
        done();
      });

      const queue = client._queue;
      assert(queue.length === 2);
      assert(queue[0][0].id === 12);
      assert(queue[1][0].id === 17);
    }, 600);

    client.send(makeRequest(12, c2), (err, res) => {
      assert.ifError(err);
      assert.deepEqual(res, c2);
      done();
    });
  });

  it('should not emit PacketParsedError if error occurred in callback function', done => {
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
      assert.ifError(err);
      throw new Error('callbackError');
    });
  });

  it('should not emit Error if socket ECONNRESET', async () => {
    const client = new Client({
      host: '127.0.0.1',
      port,
    });
    await client.ready();
    const err = new Error('123');
    err.code = 'ECONNRESET';
    client._socket.on('error', () => {
      client._socket.destroy();
    });
    await Promise.race([
      client.await('error'),
      client.await('close'),
      client._socket.emit('error', err),
    ]);
  });

  it('should handle connect timeout ok', async () => {
    const client = new Client({
      host: '1.1.1.1',
      port: 12200,
      connectTimeout: 300,
    });
    try {
      await client.ready();
      assert(false, 'should not run here');
    } catch (err) {
      assert(err.name === 'TcpConnectionTimeoutError');
      assert(err.message.includes('[TCPBase] socket connect timeout (300ms)'));
    }
  });

  it('should get error if socket is closed', async () => {
    const client = new Client({
      host: '127.0.0.1',
      port,
      connectTimeout: 300,
    });
    await client.ready();
    await client.close();
    try {
      await client.sendPromise(makeRequest(1, {}, false, 'useful tips here'));
      assert(false, 'should not run here');
    } catch (err) {
      assert.equal(err.tips, 'useful tips here');
      assert(err.message === `[TCPBase] The socket was closed. (address: 127.0.0.1:${port})`);
    }
    try {
      await Promise.race([
        client.await('error'),
        client.sendPromise(makeRequest(2, 'haha', true)),
      ]);
      assert(false, 'should not run here');
    } catch (err) {
      assert(err && err.message === `[TCPBase] The socket was closed. (address: 127.0.0.1:${port})`);
      assert(err.oneway === true);
    }
  });
});
