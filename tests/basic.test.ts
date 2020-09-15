import pull = require('pull-stream')
import MuxRpc from '../src/index'
import { Encoding } from '../src/types'
import test = require('tape')

/* Tests TODO:
 *
 * [ ] async request that responds with an error
 * [ ] a message set to json encoding but is malformed
 * [ ] no onRequest handler set
*/

test('echo', t => {
  t.plan(6)

  const rpc1 = new MuxRpc()
  const rpc2 = new MuxRpc()

  rpc1.requestAsync('BinaryEcho', ['world'], (err, res) => {
    t.error(err)
    t.same(res, Buffer.from('hi world!'))
  })
  rpc1.requestAsync('JsonEcho', ['world'], (err, res) => {
    t.error(err)
    t.same(res, { text: 'hi world!' })
  })
  rpc1.requestAsync('Utf8Echo', ['world'], (err, res) => {
    t.error(err)
    t.same(res, 'hi world!')
  })

  rpc2.onRequest((req: any, cb) => {
    const name = req.body.args[0]
    if (req.body.name === 'BinaryEcho') cb(null, Encoding.Binary, Buffer.from('hi ' + name + '!'))
    else if (req.body.name === 'JsonEcho') cb(null, Encoding.Json, { text: 'hi ' + name + '!' })
    else if (req.body.name === 'Utf8Echo') cb(null, Encoding.Utf8, 'hi ' + name + '!')
    else t.fail('unknown rpc')
  })

  pull(
    rpc1.getStream(),
    rpc2.getStream(),
    rpc1.getStream()
  )
})
