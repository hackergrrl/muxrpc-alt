const Reader = require('pull-reader')
const Pushable = require('pull-pushable')

const TYPES = [
  'source',
  // 'sink',   // XXX: not implemented
  'async',
  'duplex'
]

function RpcCore () {
  const source = Pushable(true)
  const sink = Reader()

  let requestHandler
  let nextRequestId = 1

  // Maps a request-id to a request object
  let incoming = {}
  let outgoing = {}

  function readLoop () {
    sink.read(9, (err, buf) => {
      if (err) return  // TODO: propagate error
      const header = decodeHeader(buf)

      sink.read(header.length, (err, buf) => {
        if (err) return  // TODO: propagate error

        // Decode body
        let body = buf
        if (header.encoding === 'json') body = JSON.parse(buf.toString())  // TODO: catch + propagate error
        else if (header.encoding === 'utf8') body = buf.toString()

        if (header.id > 0) {
          // TODO: handle incoming async request
          const req = {
            id: header.id,
            rpcHeader: header
          }
          incoming[header.id] = req
          console.log(header, body)

          // TODO: ???

          if (requestHandler) requestHandler(req)
        } else if (header.id < 0) {
          // TODO: handle incoming response (could be async or streaming)
        } else {
          // TODO: propagate error
          throw new Error('bad header id')
        }

        process.nextTick(readLoop)
      })
    })
  }

  // Start reading network data
  readLoop()

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

    outgoing[id] = req

    // Write the encoded request to protocol's pushable stream.
    const payload = encodeRequest(req)
    source.push(payload)

    // Return a source, sink, duplex, or nothing (for async).
    if (header.type === 'source') return req.pushable.source
    else if (header.type === 'sink') return req.sink
    else if (header.type === 'duplex') return req.duplex
  }

  // ---------------------------------------------------------------------------

  function onRequest (cb) {
    requestHandler = cb
  }
}

function encodeRequest (req) {
  const body = Buffer.from(JSON.stringify(req.header))
  const header = Buffer.alloc(9)
  
  let flags = 0
  if (req.header.type !== 'async') flags |= 1<<3
  if (req.encoding === 'utf8') flags |= 1
  else if (req.encoding === 'json') flags |= 1<<1

  header.writeUInt8(flags, 0)
  header.writeUInt32BE(body.length, 1)
  header.writeUInt32BE(req.id, 5)

  return Buffer.concat([header, body])
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

module.exports = RpcCore

