const pull = require('pull-stream')
const Reader = require('pull-reader')
const Pushable = require('pull-pushable')

/*
{
  header: {
    id,
    length,
    encoding,
    err,
    stream
  },
  body: <payload>
}
*/

function RpcCore () {
  const source = Pushable(true)

  const sink = function (read) {
    read(null, function next (err, msg) {
      if (err) return read(err)

      const id = msg.header.id

      if (incoming[id]) {
        if (!requestHandler) return read(null, next)

        // more data from a known incoming request started earlier
        console.log('got more req!')
      } else if (outgoing[-id]) {
        // response to a request we sent earlier
        console.log('got res!', msg)

        const req = outgoing[-id]
        const cb = req.cb
        delete outgoing[-id]

        // TODO: handle error in res
        if (msg.header.err) {
          cb(new Error(msg.body))
        } else {
          cb(null, msg.body)
        }
      } else {
        if (!requestHandler) return read(null, next)

        // brand new incoming request!
        console.log('brand new incoming request!', msg)
        incoming[id] = msg
        requestHandler(msg, (err, data) => {
          let res

          if (err) {
            // TODO: should an error response be a JSON body'd string?
            const body = JSON.stringify(err.message)
            res = {
              header: {
                id: -id,
                length: body.length,
                encoding: 'json',
                stream: false,
                err: true
              },
              body
            }
          } else {
            const body = JSON.stringify(data)
            res = {
              header: {
                id: -id,
                length: body.length,
                encoding: 'json',
                stream: false
              },
              body
            }
          }

          // send response back!
          source.push(res)
        })
      }

      // fetch the next incoming message
      read(null, next)
    })
  }

  let requestHandler
  let nextRequestId = 1

  // Maps a request-id to a request object
  let incoming = {}
  let outgoing = {}

  return {
    requestAsync,
    onRequest,
    stream: {
      source: pull(
        source.source,
        encodeThrough(),
        pull.map(x => { console.log('outgoing', x); return x })
      ),
      sink: pull(
        decodeThrough(),
        pull.map(x => { console.log('incoming', x); return x }),
        sink
      )
    }
  }

  // ---------------------------------------------------------------------------

  function requestAsync (name, args, cb) {
    if (!name || typeof name !== 'string') throw new Error('missing argument: name')
    if (!args || !Array.isArray(args)) throw new Error('missing argument: args')
    if (!cb || typeof cb !== 'function') throw new Error('missing argument: cb')

    const id = nextRequestId
    ++nextRequestId

    const body = JSON.stringify({
      name,
      type: 'async',
      args
    })
    const header = {
      id,
      length: body.length,
      encoding: 'json'
    }

    // Create the outgoing request object.
    const req = {
      header,
      body,
      cb
    }

    // Track the request
    outgoing[id] = req

    // Add message to outgoing queue
    console.log('pushed', req)
    source.push(req)
  }

  // ---------------------------------------------------------------------------

  function onRequest (cb) {
    requestHandler = cb
  }
}

function encodeHeader (req) {
  const header = Buffer.alloc(9)
  
  let flags = 0
  if (req.header.stream) flags |= 1<<3
  if (req.header.err) flags |= 1<<2
  if (req.header.encoding === 'utf8') flags |= 1
  else if (req.header.encoding === 'json') flags |= 1<<1

  header.writeUInt8(flags, 0)
  header.writeUInt32BE(req.body.length, 1)
  header.writeInt32BE(req.header.id, 5)

  return header
}

function encodeMessage (req) {
  const header = encodeHeader(req)
  return Buffer.concat([header, Buffer.from(req.body)])
}

function decodeHeader (buf) {
  const f = buf.readUInt8(0)
  const e = f & 3
  const header = {
    stream: !!(f & 8),
    err: !!(f & 4),
    encoding: (e === 0 ? 'binary' : (e === 1 ? 'utf8' : 'json')),
    length: buf.readUInt32BE(1),
    id: buf.readInt32BE(5)
  }
  return header
}

function decodeThrough () {
  return function (read) {
    const reader = Reader()
    reader(read)

    return function (abort, cb) {
      reader.read(9, (err, buf) => {
        if (err) return cb(err)
        const header = decodeHeader(buf)

        reader.read(header.length, (err, buf) => {
          let body = buf
          if (header.encoding === 'json') {
            try {
              body = JSON.parse(buf.toString())
            } catch (err) {
              return cb(err)
            }
          } else if (header.encoding === 'utf8') {
            body = buf.toString()
          }

          cb(null, { header, body })
        })
      })
    }
  }
}

function encodeThrough () {
  return pull.map(encodeMessage)
}

module.exports = RpcCore