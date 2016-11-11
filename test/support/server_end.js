'use strict';

const net = require('net');

let server;
exports.start = function(port, end, cb) {
  server = net.createServer({
    allowHalfOpen: true,
  }, socket => {
    socket.write(new Buffer('0000001a000000007b226964223a302c226d657373616765223a2268656c6c6f227d', 'hex'));
    console.log('socket connect', socket.remoteAddress);
    socket.on('data', data => {
      console.log('receive', data.toString());
    });

    if (end) {
      setTimeout(() => {
        console.log('end the socket');
        socket.end();
      }, 3000);
    }
  });
  server.listen(port, cb);
};

exports.close = function() {
  server && server.close();
};
