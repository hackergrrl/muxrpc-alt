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

const TYPES = [
  // 'source',
  // 'sink',   // XXX: not implemented
  'async',
  // 'duplex'
]

function RpcCore () {
  const source = Pushable(true)
  const sink = Reader()

  let requestHandler
  let nextRequestId = 1

  // Maps a request-id to a request object
  let incoming = {}
  let outgoing = {}

  return {
    request,
    onRequest,
    stream: { source: source.source, sink }
  }

  // ---------------------------------------------------------------------------

  function request (header, encoding, cb) {
    if (!header.name) throw new Error('missing header field: name')
    if (!header.type) throw new Error('missing header field: type')
    if (!header.args) header.args = []
    if (header.type === 'async' && !cb) throw new Error('missing 3rd parameter: cb')
    if (TYPES.indexOf(header.type) === -1) {
      throw new Error('invalid rpc type, must be one of: source, sink, async, duplex')
    }
    if (encoding !== 'json' && encoding !== 'binary' && encoding !== 'utf8') {
      throw new Error('invalid encoding, must be one of: json, binary, utf8')
    }

    const id = nextRequestId
    ++nextRequestId

    // TODO: make structure consistent with struct at ^^^ top
    // Create the outgoing request object.
    let req = {
      id,
      header,
      encoding,
    }

    // TODO: Add cb/streams to request object
    if (header.type === 'async') req.cb = cb
    // else if (type === 'source') req.pushable = // ???
    // else if (type === 'sink') req.sink = // ???
    // else if (type === 'duplex') req.duplex = // ???

    // Track the request
    outgoing[id] = req

    // Add message to outgoing queue
    source.push(req)

    // Return a source, sink, duplex, or nothing (for async).
    // if (header.type === 'source') return req.pushable.source
    // else if (header.type === 'sink') return req.sink
    // else if (header.type === 'duplex') return req.duplex
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
  header.writeUInt32BE(req.header.id, 5)

  return header
}

function encodeMessage (req) {
  const header = encodeHeader(req)
  return Buffer.concat([header, req.body])
}

function decodeHeader (buf) {
  const f = buf.readUInt8(0)
  const e = f & 3
  const header = {
    stream: !!(f & 8),
    err: !!(f & 4),
    encoding: (e === 0 ? 'binary' : (e === 1 ? 'utf8' : 'json')),
    length: buf.readUInt32BE(1),
    id: buf.readUInt32BE(5)
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
  return pull.map(req => {
    return encodeMessage(req)
  })
}

const pull = require('pull-stream')
const header = {
  id: 7,
  length: 10,
  encoding: 'binary',
  err: null,
  stream: false
}
const payload = {
  header,
  body: Buffer.from('helo world')
}
pull(
  pull.once(encodeMessage(payload)),
  decodeThrough(),
  pull.map(d => {
    console.log('decoded into', d)
    return d
  }),
  encodeThrough(),
  pull.map(d => {
    console.log('encoded into', d)
    return d
  }),
  decodeThrough(),
  pull.drain(console.log, err => {
    console.log('ended', err)
  })
)

module.exports = RpcCore

