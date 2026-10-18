const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const { once } = require('node:events');
const { isPortOpen, isHttpReady, findAvailablePort } = require('../src/network');

test('HTTP readiness rejects raw TCP and build errors, accepts redirects and missing root pages', async t => {
  const sockets = new Set();
  const raw = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  raw.listen(0, '127.0.0.1');
  await once(raw, 'listening');
  t.after(() => { for (const socket of sockets) socket.destroy(); raw.close(); });
  const port = raw.address().port;
  assert.equal(await isPortOpen(port), true);
  assert.equal(await isHttpReady(port), false);
  const freePort = await findAvailablePort(port);
  assert.notEqual(freePort, port);
  assert.equal(await isPortOpen(freePort), false);

  let status = 503;
  const server = http.createServer((_request, response) => { response.writeHead(status); response.end(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const httpPort = server.address().port;
  assert.equal(await isHttpReady(httpPort), false);
  for (status of [200, 302, 404]) assert.equal(await isHttpReady(httpPort), true);
});
