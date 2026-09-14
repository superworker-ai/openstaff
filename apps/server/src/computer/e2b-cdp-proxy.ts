export const E2B_CDP_NODE_PROXY = String.raw`import http from 'node:http'
import net from 'node:net'

const proxyEnv = process['env']
const listenPort = Number(proxyEnv.LISTEN_PORT || 9222)
const targetPort = Number(proxyEnv.TARGET_PORT || 9223)
const publicHost = proxyEnv.PUBLIC_HOST || ''
if (!/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(publicHost)) throw new Error('Invalid public host')

function requestHeaders(headers) {
  const result = { ...headers, host: 'localhost:' + targetPort, 'accept-encoding': 'identity' }
  delete result.connection
  delete result.upgrade
  return result
}

const server = http.createServer((incoming, outgoing) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: targetPort, path: incoming.url, method: incoming.method, headers: requestHeaders(incoming.headers) }, (response) => {
    const chunks = []
    response.on('data', (chunk) => chunks.push(chunk))
    response.on('end', () => {
      const original = Buffer.concat(chunks)
      const json = String(response.headers['content-type'] || '').includes('json')
      const body = json
        ? Buffer.from(original.toString('utf8').replace(/ws:\/\/(?:localhost|127\.0\.0\.1):9223/g, 'wss://' + publicHost))
        : original
      const headers = { ...response.headers, 'content-length': String(body.length) }
      delete headers.connection
      delete headers['transfer-encoding']
      outgoing.writeHead(response.statusCode || 502, headers)
      outgoing.end(body)
    })
  })
  upstream.on('error', () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end() })
  incoming.pipe(upstream)
})

server.on('upgrade', (request, client, head) => {
  const upstream = net.connect(targetPort, '127.0.0.1', () => {
    const lines = [request.method + ' ' + request.url + ' HTTP/' + request.httpVersion]
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index]
      const value = name.toLowerCase() === 'host' ? 'localhost:' + targetPort : request.rawHeaders[index + 1]
      lines.push(name + ': ' + value)
    }
    upstream.write(lines.join('\r\n') + '\r\n\r\n')
    if (head.length) upstream.write(head)
    client.pipe(upstream).pipe(client)
  })
  const close = () => { client.destroy(); upstream.destroy() }
  upstream.on('error', close)
  client.on('error', close)
})

server.listen(listenPort, '0.0.0.0')
`

export const E2B_CDP_PYTHON_PROXY = String.raw`import http.client
import http.server
import os
import re
import select
import socket

LISTEN_PORT = int(os.environ.get('LISTEN_PORT', '9222'))
TARGET_PORT = int(os.environ.get('TARGET_PORT', '9223'))
PUBLIC_HOST = os.environ.get('PUBLIC_HOST', '')
if not re.fullmatch(r'[a-zA-Z0-9.-]+(?::\d+)?', PUBLIC_HOST):
    raise RuntimeError('Invalid public host')

class Proxy(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, _format, *_args):
        return

    def do_GET(self):
        if self.headers.get('Upgrade', '').lower() == 'websocket':
            self.websocket()
            return
        self.forward()

    def do_POST(self):
        self.forward()

    def forward(self):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length) if length else None
        headers = {key: value for key, value in self.headers.items() if key.lower() not in ('connection', 'upgrade')}
        headers['Host'] = 'localhost:' + str(TARGET_PORT)
        headers['Accept-Encoding'] = 'identity'
        connection = http.client.HTTPConnection('127.0.0.1', TARGET_PORT, timeout=30)
        connection.request(self.command, self.path, body=body, headers=headers)
        response = connection.getresponse()
        data = response.read()
        if 'json' in (response.getheader('Content-Type') or ''):
            text = data.decode('utf-8').replace('ws://localhost:9223', 'wss://' + PUBLIC_HOST).replace('ws://127.0.0.1:9223', 'wss://' + PUBLIC_HOST)
            data = text.encode('utf-8')
        self.send_response(response.status)
        for key, value in response.getheaders():
            if key.lower() not in ('connection', 'content-length', 'transfer-encoding'):
                self.send_header(key, value)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        connection.close()

    def websocket(self):
        upstream = socket.create_connection(('127.0.0.1', TARGET_PORT), timeout=10)
        lines = [self.command + ' ' + self.path + ' ' + self.request_version]
        for key, value in self.headers.items():
            lines.append(key + ': ' + ('localhost:' + str(TARGET_PORT) if key.lower() == 'host' else value))
        upstream.sendall(('\r\n'.join(lines) + '\r\n\r\n').encode('latin1'))
        while True:
            ready, _, _ = select.select([self.connection, upstream], [], [], 60)
            if not ready:
                break
            for source in ready:
                data = source.recv(65536)
                if not data:
                    return
                (upstream if source is self.connection else self.connection).sendall(data)

class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = True

Server(('0.0.0.0', LISTEN_PORT), Proxy).serve_forever()
`
