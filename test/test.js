const pull = require('pull-stream')
const MuxRpc = require('..')
const test = require('tape')

test('noop', t => {
  t.plan(3)
  
  const rpc1 = new MuxRpc()
  const rpc2 = new MuxRpc()

  rpc1.requestAsync('Echo', ['world'], (err, res) => {
    t.error(err)
    t.same(res, 'hi world!')
  })

  rpc2.onRequest(function (req, cb ) {
    t.equals(req.body.name, 'Echo')
    cb(null, 'hi ' + req.body.args[0] + '!')
  })

  pull(
    rpc1.stream,
    rpc2.stream,
    rpc1.stream
  )
})
