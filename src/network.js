const net = require('node:net');
const http = require('node:http');

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    const finish = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(700);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

// Occupancy and readiness are separate. Redirects/404s are valid for sites
// without a root page, but a build-error response is not ready.
function isHttpReady(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', agent: false }, (response) => {
      resolve(response.statusCode >= 200 && response.statusCode < 500);
      response.destroy();
    });
    request.setTimeout(700, () => request.destroy());
    request.once('error', () => resolve(false));
  });
}

async function findAvailablePort(start = 1314) {
  for (let port = start; port <= Math.min(start + 99, 65535); port++) {
    const available = await new Promise((resolve, reject) => {
      const listener = net.createServer();
      listener.once('error', (error) => {
        if (['EADDRINUSE', 'EACCES'].includes(error.code)) resolve(false);
        else reject(error);
      });
      listener.listen({ host: '127.0.0.1', port, exclusive: true }, () => listener.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('No free Hugo port was found. Stop an unused local service and try again.');
}

module.exports = { isPortOpen, isHttpReady, findAvailablePort };
