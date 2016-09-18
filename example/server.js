'use strict';

const net = require('net');

const server = net.createServer(socket => {
  let header;
  let bodyLen;

  function readPacket() {
    if (bodyLen == null) {
      header = socket.read(8);
      if (!header) {
        return false;
      }
      bodyLen = header.readInt32BE(4);
    }

    if (bodyLen === 0) {
      socket.write(header);
    } else {
      const body = socket.read(bodyLen);
      if (!body) {
        return false;
      }
      socket.write(Buffer.concat([ header, body ]));
    }
    bodyLen = null;
    return true;
  }

  socket.on('readable', () => {
    try {
      let remaining = false;
      do {
        remaining = readPacket();
      }
      while (remaining);
    } catch (err) {
      console.error(err);
    }
  });
});
server.listen(8080);
