import pull = require('pull-stream')
import MuxRpc from '../src/index'
import test = require('tape')

test('noop', t => {
  t.plan(3)

  const rpc1 = new MuxRpc()
  const rpc2 = new MuxRpc()

  rpc1.requestAsync('Echo', ['world'], (err, res) => {
    t.error(err)
    t.same(res, 'hi world!')
  })

  rpc2.onRequest((req: any, cb: any) => {
    t.equals(req.body.name, 'Echo')
    cb(null, 'hi ' + req.body.args[0] + '!')
  })

  pull(
    rpc1.getStream(),
    rpc2.getStream(),
    rpc1.getStream()
  )
})
