import net from 'node:net'

net.createServer((client) => {
  const upstream = net.connect(9223, '127.0.0.1')
  client.pipe(upstream).pipe(client)
  client.on('error', () => upstream.destroy())
  upstream.on('error', () => client.destroy())
}).listen(9222, '0.0.0.0')
