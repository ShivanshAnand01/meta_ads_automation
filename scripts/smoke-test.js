const { spawn } = require('node:child_process')
const path = require('node:path')

const server = spawn('node', [path.join(process.cwd(), '.next', 'standalone', 'server.js')], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: '3000' },
  stdio: 'pipe',
})

let output = ''
server.stdout.on('data', (d) => { output += d.toString() })
server.stderr.on('data', (d) => { output += d.toString() })

async function test() {
  await new Promise((resolve) => setTimeout(resolve, 5000))
  for (const url of ['http://127.0.0.1:3000/', 'http://127.0.0.1:3000/login', 'http://127.0.0.1:3000/api/status']) {
    const res = await fetch(url)
    const text = await res.text()
    console.log(`${url}: ${res.status}`)
    if (res.status >= 400) console.log(text.slice(0, 200))
  }
  server.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 500))
  process.exit(0)
}

test().catch((e) => {
  console.error(e)
  server.kill('SIGTERM')
  process.exit(1)
})
