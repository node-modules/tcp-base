'use strict';

const net = require('net');

let server;
const connections = [];

exports.start = function(port, cb) {
  server = net.createServer({
    allowHalfOpen: true,
  }, socket => {
    socket.write(Buffer.from('0000001a000000007b226964223a302c226d657373616765223a2268656c6c6f227d', 'hex'));
    console.log('socket connect', socket.remoteAddress);
    socket.on('data', data => {
      console.log('receive', data.toString());
    });

    connections.push(socket);
  });
  server.listen(port, cb);
};

exports.close = function() {
  connections.forEach(conn => conn.destroy());
  server && server.close();
};
