'use strict';

const net = require('net');
const is = require('is-type-of');
const assert = require('assert');
const Base = require('sdk-base');

const addressKey = Symbol('address');
const defaultOptions = {
  noDelay: true,
  responseTimeout: 3000,
  heartbeatInterval: 5000,
  needHeartbeat: true,
  concurrent: 0,
  reConnectTimes: 0,
  reConnectInterval: 1000,
};
const noop = () => {};
let seed = 0;

class TCPBase extends Base {
  /**
   * tcp 客户端的基类
   * @param {Object} options
   *   - {String} host - 服务器地址
   *   - {Number} port - 服务器端口
   *   - {Number} headerLength - 通讯协议头部长度, 可选， 不传的话就必须实现getHeader方法
   *   - {Boolean} [noDelay] - 是否开启 Nagle 算法，默认：true，不开启
   *   - {Number} [concurrent] - 并发请求数，默认：0，不控制并发
   *   - {Number} [responseTimeout] - 请求超时
   *   - {Number} [reConnectTimes] - 自动最大重连次数，默认：0，不自动重连，当重连次数超过此值时仍然无法连接就触发close error事件
   *   - {Number} [reConnectInterval] - 重连时间间隔，默认： 1s，当reConnectTimes大于0时才有效
   * @constructor
   */
  constructor(options) {
    super();

    this.options = Object.assign({}, defaultOptions, options);
    assert(this.options.host, 'options.host is required');
    assert(this.options.port, 'options.port is required');

    if (this.options.needHeartbeat) {
      assert(this.heartBeatPacket, 'heartBeatPacket getter must be implemented if needHeartbeat');
    }

    this.clientId = ++seed;
    this._reConnectTimes = this.options.reConnectTimes;
    this._heartbeatTimer = null;
    this._socket = null;
    this._header = null;
    this._bodyLength = null;
    this._queue = [];
    this._invokes = new Map();
    this[addressKey] = this.options.host + ':' + this.options.port;

    this._connect();
  }

  /**
   * 读取 packet 的头部
   * @return {Buffer} header
   */
  getHeader() {
    return this.read(this.options.headerLength);
  }

  /* eslint-disable valid-jsdoc, no-unused-vars */

  /**
   * 根据头部信息获取 body 的长度
   * @param {Buffer} header - 头部数据
   * @return {Number} bodyLength
   */
  getBodyLength(header) {
    throw new Error('not implement');
  }

  /**
   * 获取心跳包
   * @property {Buffer} TCPBase#heartBeatPacket
   */
  get heartBeatPacket() {
    throw new Error('not implement');
  }

  /**
   * 发送心跳包, 可以被覆盖，比如有些场景需要处理心跳响应
   * @return {void}
   */
  sendHeartBeat() {
    this._socket.write(this.heartBeatPacket);
  }

  /**
   * 反序列化
   * @param {Buffer} buf - 二进制数据
   * @return {Object} 对象
   */
  decode(buf) {
    throw new Error('not implement');
  }

  /* eslint-enable valid-jsdoc, no-unused-vars */

  /**
   * 当前socket是否可写，达到最大并发时应该等待
   * @property {Boolean} TCPBase#_writable
   */
  get _writable() {
    if (this.options.concurrent && this._invokes.size >= this.options.concurrent) {
      return false;
    }

    return this.isOK;
  }

  /**
   * 连接是否正常
   * @property {Boolean} TCPBase#isOK
   */
  get isOK() {
    return this._socket && this._socket.writable;
  }

  /**
   * 服务地址
   * @property {String} TCPBase#address
   */
  get address() {
    return this[addressKey];
  }

  /**
   * 从socket缓冲区中读取n个buffer
   * @param {Number} n - buffer长度
   * @return {Buffer} - 读取到的buffer
   */
  read(n) {
    return this._socket.read(n);
  }

  /**
   * 发送数据
   * @param {Object} packet
   *   - {Number} id - packet id
   *   - {Buffer} data - 发送的二进制数据
   *   - {Boolean} [oneway] - 是否单向
   *   - {Number} [timeout] - 请求超时时长
   * @param {Function} [callback] - 回调函数，可选
   * @return {void}
   */
  send(packet, callback) {
    // 如果有设置并发，不应该再写入，等待正在处理的请求已完成；或者当前没有可用的socket，等待重新连接后再继续send
    callback = callback || noop;

    if (packet.oneway) {
      this._socket.write(packet.data);
      callback();
      return;
    }

    if (!this._writable) {
      this._queue.push([ packet, callback ]);
      // 如果设置重连的话还有可能挽回这些请求
      if (!this._socket && !this._reConnectTimes) {
        this._cleanQueue();
      }
      return;
    }
    const meta = {
      id: packet.id,
      dataLength: packet.data.length,
      bufferSize1: this._socket.bufferSize,
      bufferSize2: -1,
      startTime: Date.now(),
      endTime: -1,
    };
    let endTime;
    this._socket.write(packet.data, () => {
      endTime = Date.now();
    });
    const timeout = packet.timeout || this.options.responseTimeout;
    this._invokes.set(packet.id, {
      meta,
      packet,
      timer: setTimeout(() => {
        meta.bufferSize2 = this._socket.bufferSize;
        meta.endTime = endTime;
        this._finishInvoke(packet.id);
        const err = new Error(`Server no response in ${timeout}ms, address#${this[addressKey]}`);
        err.socketMeta = meta;
        err.name = 'ResponseTimeoutError';
        callback(err);
      }, timeout),
      callback,
    });
  }

  /**
   * 发送数据
   * @param {Object} packet
   *   - {Number} id - packet id
   *   - {Buffer} data - 发送的二进制数据
   *   - {Boolean} [oneway] - 是否单向
   *   - {Number} [timeout] - 请求超时时长
   * @return {Function} thunk
   */
  sendThunk(packet) {
    return callback => this.send(packet, callback);
  }

  _finishInvoke(id) {
    this._invokes.delete(id);
    if (this._writable) {
      this._resume();
    }
  }

  _errorCallback(callback, err) {
    if (!err) {
      err = new Error(`The socket was closed. (address: ${this[addressKey]})`);
      err.name = 'SocketCloseError';
    }
    callback && callback(err);
  }

  // 清理未完成的调用
  _cleanInvokes(err) {
    for (const id of this._invokes.keys()) {
      const req = this._invokes.get(id);
      clearTimeout(req.timer);
      this._errorCallback(req.callback, err);
    }
    this._invokes.clear();
  }

  // 清理未发出的请求
  _cleanQueue(err) {
    let args = this._queue.pop();
    while (args) {
      // args[0] 是packet， args[1]是callback
      this._errorCallback(args[1], err);
      args = this._queue.pop();
    }
  }

  // 缓冲区空闲，重新尝试写入
  _resume() {
    const args = this._queue.shift();
    if (args) {
      this.send(args[0], args[1]);
    }
  }

  // 读取服务器端数据，反序列化成对象
  _readPacket() {
    if (is.nullOrUndefined(this._bodyLength)) {
      this._header = this.getHeader();
      if (!this._header) {
        return false;
      }
      // 通过头部信息获得body的长度
      this._bodyLength = this.getBodyLength(this._header);
    }

    let body;
    // body 可能为空
    if (this._bodyLength > 0) {
      body = this.read(this._bodyLength);
      if (!body) {
        return false;
      }
    }
    this._bodyLength = null;
    const entity = this.decode(body, this._header);
    // 约定返回一个对象
    // {
    //   id: '请求id',
    //   isResponse: true,
    //   data: {}  // 反序列化的对象
    // }
    let type = 'request';
    // 如果没有指定 isResponse，通过id是否和invoke匹配来判断是否是response
    if (!entity.hasOwnProperty('isResponse')) {
      entity.isResponse = this._invokes.has(entity.id);
    }
    if (entity.isResponse) {
      type = 'response';
      const invoke = this._invokes.get(entity.id);
      if (invoke) {
        this._finishInvoke(entity.id);
        clearTimeout(invoke.timer);
        invoke.callback(entity.error, entity.data);
      }
    }
    // 当不需要触发response/request 事件时data留空
    if (entity.data) {
      // 上层应用处理request/response事件时抛出的异常不应该被底层捕获，并当作PacketParsedError处理
      setImmediate(() => {
        this.emit(type, entity, this[addressKey]);
      });
    }
    return true;
  }

  /**
   * 关闭连接
   * @param {Error} err - 导致关闭连接的异常
   * @return {void}
   */
  close(err) {
    if (!this._socket) {
      return;
    }
    this._socket.destroy();
    this._handleClose(err);
  }

  _handleClose(err) {
    if (!this._socket) {
      return;
    }

    this._socket.removeAllListeners();
    this._socket = null;

    if (err) {
      this.emit('error', err);
    }

    this._cleanInvokes(err);
    // clean timer
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    // 自动重连接
    if (this._reConnectTimes) {
      setTimeout(() => {
        this._reConnectTimes--;
        this._connect(() => {
          // 连接成功后重新设置可重连次数
          this._reConnectTimes = this.options.reConnectTimes;
          // 继续处理由于socket断开遗留的请求
          this._resume();
        });
      }, this.options.reConnectInterval);
      return;
    }
    this._cleanQueue(err);
    // 触发 close 事件，告诉使用者连接被关闭了，需要重新处理
    this.emit('close');
    this.removeAllListeners();
  }

  // 连接
  _connect(done) {
    if (!done) {
      done = () => this.ready(true);
    }

    const socket = this._socket = net.connect(this.options.port, this.options.host);
    socket.setNoDelay(this.options.noDelay);
    socket.on('readable', () => {
      try {
        // 在这里循环读，避免在 _readPacket 里嵌套调用，导致调用栈过长
        let remaining = false;
        do {
          remaining = this._readPacket();
        }
        while (remaining);
      } catch (err) {
        this.close(err);
      }
    });

    socket.once('close', () => this._handleClose());
    socket.once('error', err => {
      err.message += ' (address: ' + this[addressKey] + ')';
      this.close(err);
    });

    socket.once('connect', done);

    if (this.options.needHeartbeat) {
      this._heartbeatTimer = setInterval(() => {
        // 已经有请求在等待响应，则不需要发送心跳了
        if (this._invokes.size > 0 || !this.isOK) {
          return;
        }
        this.sendHeartBeat();
      }, this.options.heartbeatInterval);
    }
  }
}

module.exports = TCPBase;
