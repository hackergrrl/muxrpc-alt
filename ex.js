const pull = require('pull-stream')
const muxrpc = require('.')

const rpc1 = muxrpc()
const rpc2 = muxrpc()

rpc1.requestAsync('Echo', ['@FCX/tsDLpubCPKKfIrw4gc+SQkHcaD17s7GI6i/ziWY=.ed25519'], (err, res) => {
  if (err) throw err
  console.log('got response!', res)
})

rpc2.onRequest(function (req, cb) {
  if (req.body.name === 'Echo') {
    cb(null, 'hi ' + req.body.args[0] + '!')
  } else {
    cb(new Error('unknown rpc: ' + req.body.name))
  }
})

pull(
  rpc1.stream,
  rpc2.stream,
  rpc1.stream
)
