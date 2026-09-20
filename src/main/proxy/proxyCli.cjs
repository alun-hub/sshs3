/**
 * sshs3 ProxyCommand CLI Helper for OpenSSH.
 * Usage: node proxyCli.cjs <type> <proxyHost> <proxyPort> <targetHost> <targetPort>
 *
 * Proxy username/password (if any) are read from the SSHS3_PROXY_USERNAME /
 * SSHS3_PROXY_PASSWORD environment variables rather than argv: this script
 * is invoked as an OpenSSH ProxyCommand, which OpenSSH always runs through a
 * shell — putting free-text credentials on that command line would let
 * shell metacharacters in them break out and execute arbitrary commands.
 * Environment variables carry arbitrary bytes safely with no shell parsing.
 */
const net = require('node:net');

const [,, type, proxyHost, proxyPortStr, targetHost, targetPortStr] = process.argv;
const username = process.env.SSHS3_PROXY_USERNAME || '';
const password = process.env.SSHS3_PROXY_PASSWORD || '';

if (!type || !proxyHost || !proxyPortStr || !targetHost || !targetPortStr) {
  process.stderr.write('Usage: proxyCli.cjs <type> <proxyHost> <proxyPort> <targetHost> <targetPort> [username] [password]\n');
  process.exit(1);
}

const proxyPort = parseInt(proxyPortStr, 10);
const targetPort = parseInt(targetPortStr, 10);

const socket = net.connect({ host: proxyHost, port: proxyPort });

socket.on('error', (err) => {
  process.stderr.write(`Proxy error: ${err.message}\n`);
  process.exit(1);
});

socket.on('connect', async () => {
  try {
    if (type === 'http') {
      let req = `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n`;
      if (username) {
        const auth = Buffer.from(`${username}:${password || ''}`).toString('base64');
        req += `Proxy-Authorization: Basic ${auth}\r\n`;
      }
      req += 'Proxy-Connection: Keep-Alive\r\n\r\n';
      socket.write(req);

      let resp = '';
      const onData = (chunk) => {
        resp += chunk.toString('latin1');
        const idx = resp.indexOf('\r\n\r\n');
        if (idx !== -1) {
          socket.removeListener('data', onData);
          const firstLine = resp.split('\r\n')[0];
          const match = firstLine.match(/^HTTP\/1\.[01]\s+(\d{3})/i);
          if (!match || parseInt(match[1], 10) < 200 || parseInt(match[1], 10) >= 300) {
            process.stderr.write(`HTTP proxy rejected CONNECT: ${firstLine}\n`);
            process.exit(1);
          }
          const rest = Buffer.from(resp.slice(idx + 4), 'latin1');
          if (rest.length > 0) {
            process.stdout.write(rest);
          }
          pipeStreams();
        }
      };
      socket.on('data', onData);
    } else if (type === 'socks5') {
      // Greeting
      if (username) {
        socket.write(Buffer.from([0x05, 0x02, 0x00, 0x02]));
      } else {
        socket.write(Buffer.from([0x05, 0x01, 0x00]));
      }

      const methodBuf = await readChunk(socket, 2);
      if (methodBuf[1] === 0xff) {
        process.stderr.write('SOCKS5 proxy authentication error\n');
        process.exit(1);
      }

      if (methodBuf[1] === 0x02) {
        const uBuf = Buffer.from(username || '');
        const pBuf = Buffer.from(password || '');
        socket.write(Buffer.concat([Buffer.from([0x01, uBuf.length]), uBuf, Buffer.from([pBuf.length]), pBuf]));
        const authRes = await readChunk(socket, 2);
        if (authRes[1] !== 0x00) {
          process.stderr.write('SOCKS5 user/pass authentication failed\n');
          process.exit(1);
        }
      }

      const hBuf = Buffer.from(targetHost);
      socket.write(Buffer.concat([
        Buffer.from([0x05, 0x01, 0x00, 0x03, hBuf.length]),
        hBuf,
        Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])
      ]));

      const reply = await readChunk(socket, 4);
      if (reply[1] !== 0x00) {
        process.stderr.write(`SOCKS5 CONNECT failed with code ${reply[1]}\n`);
        process.exit(1);
      }

      const atyp = reply[3];
      if (atyp === 0x01) await readChunk(socket, 6);
      else if (atyp === 0x03) {
        const l = await readChunk(socket, 1);
        await readChunk(socket, l[0] + 2);
      } else if (atyp === 0x04) await readChunk(socket, 18);

      pipeStreams();
    } else if (type === 'socks4') {
      const uBuf = Buffer.from(username || 'user');
      const hBuf = Buffer.from(targetHost);
      socket.write(Buffer.concat([
        Buffer.from([0x04, 0x01, (targetPort >> 8) & 0xff, targetPort & 0xff, 0x00, 0x00, 0x00, 0x01]),
        uBuf,
        Buffer.from([0x00]),
        hBuf,
        Buffer.from([0x00])
      ]));
      const reply = await readChunk(socket, 8);
      if (reply[1] !== 0x5a) {
        process.stderr.write(`SOCKS4 CONNECT rejected code: ${reply[1]}\n`);
        process.exit(1);
      }
      pipeStreams();
    }
  } catch (err) {
    process.stderr.write(`Proxy handshake error: ${err.message}\n`);
    process.exit(1);
  }
});

function pipeStreams() {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
  socket.on('close', () => process.exit(0));
}

function readChunk(sock, n) {
  return new Promise((resolve) => {
    let b = Buffer.alloc(0);
    const onData = (chunk) => {
      b = Buffer.concat([b, chunk]);
      if (b.length >= n) {
        sock.removeListener('data', onData);
        const res = b.subarray(0, n);
        const rest = b.subarray(n);
        if (rest.length > 0) sock.unshift(rest);
        resolve(res);
      }
    };
    sock.on('data', onData);
  });
}
