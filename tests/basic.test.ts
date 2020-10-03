import pull = require('pull-stream')
import MuxRpc from '../src/index'
import { Encoding } from '../src/types'
import test = require('tape')
import net = require('net')
import crypto = require('crypto')
import toPull = require('stream-to-pull-stream')

/* Tests TODO:
 *
 * [ ] async request that responds with an error
 * [ ] a message set to json encoding but is malformed
 * [ ] no onRequest handler set
*/

test('binary echo', t => {
  t.plan(2)

  const rpc1 = new MuxRpc(onRequest)
  const rpc2 = new MuxRpc(onRequest)

  rpc1.requestAsync('BinaryEcho', ['world'], (err, res) => {
    t.error(err)
    t.same(res, Buffer.from('hi world!'))
  })

  function onRequest(req: any, cb: any) {
    const name = req.body.args[0]
    if (req.body.name === 'BinaryEcho') {
      cb(null, Encoding.Binary, Buffer.from('hi ' + name + '!'))
    } else t.fail('unknown rpc')
  }

  pull(
    rpc1.getStream(),
    rpc2.getStream(),
    rpc1.getStream()
  )
})

test('json echo', t => {
  t.plan(2)

  const rpc1 = new MuxRpc(onRequest)
  const rpc2 = new MuxRpc(onRequest)

  rpc1.requestAsync('JsonEcho', ['world'], (err, res) => {
    t.error(err)
    t.same(res, { text: 'hi world!' })
  })

  function onRequest(req: any, cb: any) {
    const name = req.body.args[0]
    if (req.body.name === 'JsonEcho') {
      cb(null, Encoding.Json, { text: 'hi ' + name + '!' })
    } else t.fail('unknown rpc')
  }

  pull(
    rpc1.getStream(),
    rpc2.getStream(),
    rpc1.getStream()
  )
})

test('utf-8 echo', t => {
  t.plan(2)

  const rpc1 = new MuxRpc(onRequest)
  const rpc2 = new MuxRpc(onRequest)

  rpc1.requestAsync('Utf8Echo', ['world'], (err, res) => {
    t.error(err)
    t.same(res, 'hi world!')
  })

  function onRequest(req: any, cb: any) {
    const name = req.body.args[0]
    if (req.body.name === 'Utf8Echo') {
      cb(null, Encoding.Utf8, 'hi ' + name + '!')
    } else t.fail('unknown rpc')
  }

  pull(
    rpc1.getStream(),
    rpc2.getStream(),
    rpc1.getStream()
  )
})

test('async error', t => {
  t.plan(2)

  const rpc1 = new MuxRpc(onRequest)
  const rpc2 = new MuxRpc(onRequest)

  rpc1.requestAsync('Fail', [], (err, res) => {
    t.same(err, new Error('broken'))
    t.false(res)
  })

  function onRequest(req: any, cb: any) {
    cb(new Error('broken'))
  }

  pull(
    rpc1.getStream(),
    rpc2.getStream(),
    rpc1.getStream()
  )
})

test('source rpc', t => {
  t.plan(2)

  const rpc1 = new MuxRpc(onRequest)
  const rpc2 = new MuxRpc(onRequest)

  const src = rpc1.requestSource('RandomStream', [])
  pull(
    src,
    pull.collect((err, values) => {
      t.error(err)
      t.deepEqual(values, [1, 2, 3])
    })
  )

  function onRequest(req: any, cb: any) {
    if (req.body.name === 'RandomStream') {
      return { stream: pull.values([1, 2, 3]), encoding: 'json' }
    } else t.fail('unknown rpc')
  }

  pull(
    rpc1.getStream(),
    rpc2.getStream(),
    rpc1.getStream()
  )
})

test('streaming source rpc over tcp with backpressure', t => {
  t.plan(4)

  const port = 7177
  const serverRpc = new MuxRpc(onRequest)
  const clientRpc = new MuxRpc(onRequest)
  let clientSocket: net.Socket
  let server: net.Server
  let bytesWritten = 0
  let bytesRead = 0

  setupConnections(() => {
    makeRequest()
  })

  function makeRequest() {
    const src = clientRpc.requestSource('DownloadBigFile', []) as pull.Source<Buffer>
    const bytesDifference: Array<number> = []
    pull(
      src,
      // slow part of pipeline
      pull.asyncMap((data, next) => {
        setTimeout(() => {
          bytesRead += data.length
          bytesDifference.push(bytesWritten - bytesRead)
          next(null, data)
        }, 1)
      }),
      pull.drain(() => { },
        err => {
          t.error(err)
          t.ok(bytesDifference.every(diff => diff < 12_000_000), 'less than 12mb in the pipeline at once')
          t.equals(bytesRead, 100_000_000)

          clientSocket.end(() => {
            server.close(() => {
              t.pass('server closed ok')
            })
          })
        })
    )
  }

  function onRequest(req: any, cb: any) {
    if (req.body.name === 'DownloadBigFile') {
      // 10mb in 64kib chunks
      const source = pull(
        randomDataSource(100_000_000, 65535),
        pull.through(data => {
          bytesWritten += data.length
        })
      )
      return { stream: source, encoding: 'binary' }
    } else t.fail('unknown rpc')
  }

  function setupConnections(cb: any) {
    server = net.createServer(socket => {
      pull(
        serverRpc.getStream(),
        toPull.duplex(socket),
        serverRpc.getStream()
      )
    })
    server.listen(port, () => {
      clientSocket = net.connect(port)
      pull(
        clientRpc.getStream(),
        toPull.duplex(clientSocket),
        clientRpc.getStream()
      )
      cb()
    })
  }
})

function randomDataSource(bytes: number, chunkSize: number): pull.Source<Buffer> {
  let sofar = 0
  return function(abort, cb) {
    if (abort) return
    if (sofar >= bytes) return cb(true)

    let len = chunkSize
    if (sofar + chunkSize > bytes) len = bytes - sofar
    sofar += len
    //    console.log('ok fine, here\'s', len, 'bytes!')
    cb(null, crypto.randomBytes(len))
  }
}
