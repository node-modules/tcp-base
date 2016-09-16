'use strict';

const net = require('net');
let server;
let header;
let bodyLen = null;

module.exports = {
  start(port, callback) {
    server = net.createServer(c => { // 'connection' listener
      function handle() {
        if (!bodyLen) {
          header = c.read(8);
          if (!header) {
            return;
          }
          bodyLen = header.readInt32BE(0);
        }

        if (bodyLen === 0) {
          c.write(header);
          return;
        }

        const body = c.read(bodyLen);
        if (!body) {
          return;
        }

        const obj = JSON.parse(body);

        if (obj.oneway) {
          header = null;
          bodyLen = null;
          handle();
          return;
        }

        if (obj.timeout) {
          const buf = Buffer.concat([ header, body ]);
          setTimeout(() => c.write(buf), obj.timeout);
        } else if (!obj.noResponse) {
          c.write(Buffer.concat([ header, body ]));
        }
        bodyLen = null;
        header = null;
        handle();
      }

      c.on('readable', () => handle());
      c.on('error', () => {});
    });
    server.listen(port, callback);
  },
  close() {
    server.close();
  },
};
