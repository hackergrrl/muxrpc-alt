import pull = require('pull-stream')
import { MessageBody, MessageHeader, Message, RequestMessage, RequestHandlerCb, Encoding } from './types'
import Reader = require('pull-reader')
import Pushable = require('pull-pushable')

export class MuxRpc {
  private requestHandlerFn: RequestHandlerCb
  private nextRequestId: number

  // Maps a request-id to a request object
  private incoming: Map<number, Message>
  private outgoing: Map<number, RequestMessage>

  // Incoming and outgoing RPC protocol streams
  private source: Pushable<Message>
  private stream: pull.Duplex<Buffer, Message>

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
        pull.drain(this.handleIncomingMessage.bind(this))
      )
    }
  }

  getStream() {
    return this.stream
  }

  requestAsync(name: string, args: Array<any>, cb: (err: Error, req: Message) => void) {
    const id = this.nextRequestId++

    const body = { name, type: 'async', args }
    const header = {
      id,
      length: 0,
      encoding: Encoding.Json,
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

  onRequest(cb: RequestHandlerCb) {
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

    // TODO: support cancellation, so the cb below doesn't do anything
    this.requestHandlerFn(msg, (err, enc, data) => {
      let body = err ? err.message : data
      const res = {
        header: {
          id: -msg.header.id,
          length: -1,
          encoding: enc,
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
  if (req.header.encoding === Encoding.Utf8) flags |= 1
  else if (req.header.encoding === Encoding.Json) flags |= 1 << 1

  const length = encodeMessageBody(req.body, req.header.encoding).length

  header.writeUInt8(flags, 0)
  header.writeUInt32BE(length, 1)
  header.writeInt32BE(req.header.id, 5)

  return header
}

function encodeMessage(req: Message): Buffer {
  const header = encodeHeader(req)
  const body = encodeMessageBody(req.body, req.header.encoding)
  return Buffer.concat([header, body])
}

function decodeHeader(buf: Buffer): MessageHeader {
  const f = buf.readUInt8(0)
  const e = f & 3
  const header = {
    stream: !!(f & 8),
    err: !!(f & 4),
    encoding: (e === 0 ? Encoding.Binary : (e === 1 ? Encoding.Utf8 : Encoding.Json)),
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
        console.log('header', header)

        // read body
        reader.read(header.length, (err, buf) => {
          if (err) return reader.abort(err)
          console.log('incoming', header, buf.toString())
          try {
            const body = decodeMessageBody(buf, header.encoding)
            console.log('decoded', body)
            cb(null, { header, body })
          } catch (e) {
            return cb(e)
          }
        })
      })
    }
  }
}

function decodeMessageBody(data: Buffer, encoding: Encoding): MessageBody {
  if (encoding === Encoding.Json) {
    return JSON.parse(data.toString())
  } else if (encoding === Encoding.Utf8) {
    return data.toString()
  } else {
    return data
  }
}

function encodeMessageBody(data: MessageBody, encoding: Encoding): Buffer {
  if (encoding === Encoding.Json) {
    return Buffer.from(JSON.stringify(data))
  } else {
    return Buffer.from(data)
  }
}

function encodeThrough() {
  return pull.map(encodeMessage)
}

export default MuxRpc
