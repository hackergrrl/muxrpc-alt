import pull = require('pull-stream')
import Reader = require('pull-reader')
import Pushable = require('pull-pushable')

class MuxRpc {
  requestHandlerFn: (msg: Message, cb: (err: Error, res: Message) => void) => void
  nextRequestId: number

  // Maps a request-id to a request object
  incoming: Map<number, Message>
  outgoing: Map<number, RequestMessage>

  // Incoming and outgoing RPC protocol streams
  source: Pushable<Message>
  sink: pull.Sink<Buffer>
  stream: pull.Duplex<Buffer, Message>

  constructor() {
    this.nextRequestId = 1

    // Maps a request-id to a request object
    this.incoming = new Map<number, Message>()
    this.outgoing = new Map<number, RequestMessage>()

    // The RPC protocol stream
    this.source = Pushable(true)
    this.stream = {
      source: pull(
        // TODO: have Pushable be part of a pull-many with other sources/duplexes(?)
        this.source,
        encodeThrough()
      ),
      sink: pull(
        decodeThrough(),
        pull.drain(this.handleIncomingMessage)
      )
    }
  }

  requestAsync(name: string, args: Array<any>, cb: (err: Error, req: Message) => void) {
    const id = this.nextRequestId++

    const body = Buffer.from(JSON.stringify({ name, type: 'async', args }))
    const header = {
      id,
      length: body.length,
      encoding: 'json',
      stream: false
    }

    // Create the outgoing request object.
    const req = { header, body, cb }

    // Track the request
    this.outgoing.set(id, req)

    // Add message to outgoing queue
    console.log('pushed outgoing', req)
    this.source.push(req)
  }

  onRequest(cb: (msg: Message, cb: (err: Error, res: Message) => void) => void) {
    this.requestHandlerFn = cb
  }

  handleIncomingMessage(msg: Message) {
    const id = msg.header.id

    if (this.incoming.has(id)) {
      if (!this.requestHandlerFn) return
      // more data from a known incoming request started earlier (duplex, sink)
      console.log('got more req!')
    } else if (this.outgoing.has(-id)) {
      if (!msg.header.stream) this.handleAsyncResponse(msg)
    } else {
      this.handleNewRequest(msg)
    }
  }

  handleAsyncResponse(res: Message) {
    console.log('got res!', res)

    const req = this.outgoing.get(-res.header.id)
    if (!req) {
      return false
    }
    const cb = req.cb
    this.outgoing.delete(-res.header.id)

    if (res.header.err) {
      cb(new Error(res.body.toString()), null)
    } else {
      cb(undefined, res.body)
    }
  }

  handleNewRequest(msg: Message) {
    if (!this.requestHandlerFn) return

    console.log('brand new incoming request!', msg)
    this.incoming.set(msg.header.id, msg)

    // TODO: support cancellation, so the cb below does nothing!
    this.requestHandlerFn(msg, (err, data) => {
      // TODO: should an error response be a JSON body'd string?
      const body = JSON.stringify(err ? err.message : data)
      const res = {
        header: {
          id: -msg.header.id,
          length: body.length,
          encoding: 'json',
          stream: false,
          err: !!err
        },
        body
      }

      // send response back!
      this.source.push(res)
    })
  }
}

function encodeHeader(req: Message) {
  const header = Buffer.alloc(9)

  let flags = 0
  if (req.header.stream) flags |= 1 << 3
  if (req.header.err) flags |= 1 << 2
  if (req.header.encoding === 'utf8') flags |= 1
  else if (req.header.encoding === 'json') flags |= 1 << 1

  header.writeUInt8(flags, 0)
  header.writeUInt32BE(req.body.length, 1)
  header.writeInt32BE(req.header.id, 5)

  return header
}

function encodeMessage(req: Message): Buffer {
  const header = encodeHeader(req)
  return Buffer.concat([header, Buffer.from(req.body)])
}

function decodeHeader(buf: Buffer): MessageHeader {
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

function decodeThrough() {
  return function(read: any) {
    // make the sink side of this through is a pull-reader
    const reader = Reader<Buffer>()
    reader(read)

    return (abort: pull.Abort, cb: pull.SourceCallback<Message>) => {
      if (abort) return reader.abort(abort)

      // read header
      reader.read(9, (err, buf) => {
        if (err) return cb(err)
        const header = decodeHeader(buf)

        // read body
        reader.read(header.length, (err, buf) => {
          if (err) return reader.abort(err)

          let body: MessageBody = buf

          // re-encode body
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

function encodeThrough() {
  return pull.map(encodeMessage)
}

module.exports = MuxRpc
