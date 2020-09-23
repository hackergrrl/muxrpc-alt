import pull = require('pull-stream')
import { RequestMessage, MessageBody, MessageHeader, Message, AsyncMessage, RequestHandlerCb, Encoding } from './types'
import Reader = require('pull-reader')
import Pushable = require('pull-pushable')
const Many = require('pull-many')
const Router = require('pull-router')

export class MuxRpc {
  private requestHandlerFn: RequestHandlerCb
  private nextRequestId: number

  // Maps a request-id to a request object
  private incoming: Map<number, Message>
  private outgoing: Map<number, RequestMessage>

  // Tracks all sub-sources and sub-sinks
  private sinks: Map<number, pull.Sink<any>>
  private sources: Map<number, pull.Source<any>>
  private multiplexedSend: any
  private multiplexedRecv: any

  // Incoming and outgoing RPC protocol streams
  private source: Pushable<Message>
  private stream: pull.Duplex<Buffer, Message>
  private encoder: pull.Through<Message, Buffer>

  constructor(requestHandler: RequestHandlerCb) {
    this.requestHandlerFn = requestHandler
    this.nextRequestId = 1

    // Maps a request-id to a request object
    this.incoming = new Map<number, Message>()
    this.outgoing = new Map<number, RequestMessage>()

    this.sinks = new Map<number, pull.Sink<any>>()
    this.sources = new Map<number, pull.Source<any>>()
    this.encoder = encodeThrough()

    // The RPC protocol stream
    this.source = Pushable(true)
    this.multiplexedSend = Many([this.source.source])
    this.multiplexedRecv = Router()

    // Q: What kinds of incoming messages can we receive?
    // 1. a brand new {async,source,duplex} request
    // 2. a response to an async request we sent
    // 3. streaming data from a source request we sent
    // 4. streaming data from a duplex request we sent OR received

    // TODO: need to figure out how to incorporate router here
    // XXX: possible to have pull-router just take a func that takes the payload and returns a sink???

    // New incoming async request
    this.multiplexedRecv.addRoute((msg: Message) => {
      if (!this.incoming.has(msg.header.id) && !this.outgoing.has(-msg.header.id)) {
        if (msg.header.encoding === Encoding.Json && typeof msg.body === 'object') {
          const body = (msg.body as any)
          return body.type && body.type === 'async'
        }
      }
      return false
    }, pull.drain(this.handleNewAsyncRequest.bind(this)))

    // Async response
    this.multiplexedRecv.addRoute((msg: Message) => {
      const req = this.outgoing.get(-msg.header.id)
      return req && req.body.type === 'async'
    }, pull.drain(this.handleAsyncResponse.bind(this)))

    // New incoming source request
    this.multiplexedRecv.addRoute((msg: Message) => {
      if (!this.incoming.has(msg.header.id) && !this.outgoing.has(-msg.header.id)) {
        if (msg.header.encoding === Encoding.Json && typeof msg.body === 'object') {
          const body = (msg.body as any)
          return body.type && body.type === 'source'
        }
      }
      return false
    }, pull.drain(this.handleNewSourceRequest.bind(this)))

    this.stream = {
      source: pull(
        this.multiplexedSend,
        pull.through(data => {
          console.log('gonna send', data)
        }),
        this.encoder
      ),
      sink: pull(
        pull.through(data => {
          console.log('recvd', (data as any).length, 'bytes')
        }),
        decodeThrough(),
        this.multiplexedRecv as pull.Sink<Message>
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
    this.source.push(req)
  }

  requestSource(name: string, args: Array<any>): pull.Source<MessageBody> {
    const id = this.nextRequestId++

    const body = { name, type: 'source', args }
    const header = {
      id,
      length: 0,
      encoding: Encoding.Json,
      stream: true
    }

    // Create the outgoing request object.
    const req = { header, body }

    // Track the request
    this.outgoing.set(id, req)

    // Add message to outgoing queue
    this.source.push(req)

    return this.addRecvStream(id)
  }

  addRecvStream(id: number): any {
    const thru: pull.Through<Message, MessageBody> = function unwrapMessage(read) {
      return function(abort, cb) {
        read(abort, function next(err, msg) {
          if (!msg || err) return cb(err)
          if (msg.header.err) {
            cb(msg.body as any)
          } else {
            cb(null, msg.body)
          }
        })
      }
    }
    this.sinks.set(id, thru)

    // Incoming source stream data
    // Q: how to handle err/true?
    return this.multiplexedRecv.addRoute((msg: Message) => {
      return msg.header.id === -id
    }, thru)
  }

  addSendStream(id: number, enc: Encoding, src: pull.Source<MessageBody>) {
    let sentErr = false
    const stream = pull(
      src,
      // TODO: make into its own standalone function
      function wrapMessage(read) {
        return function(abort, cb) {
          read(abort, function next(err, data) {
            if (err) {
              if (sentErr) return cb(err)
              sentErr = true
              cb(null, {
                header: {
                  id: -id,
                  length: -1,
                  encoding: Encoding.Json,
                  stream: true,
                  err: true
                },
                body: err
              })
            } else {
              cb(null, {
                header: {
                  id: -id,
                  length: -1,
                  encoding: enc,
                  stream: true,
                  err: null
                },
                body: data
              })
            }
          })
        }
      }
    )
    this.sources.set(id, stream)
    this.multiplexedSend.add(stream)
  }

  handleAsyncResponse(res: Message) {
    //    console.log('got res!', res)

    const req = this.outgoing.get(-res.header.id)
    if (!req) return

    const cb = (req as AsyncMessage).cb
    this.outgoing.delete(-res.header.id)

    if (res.header.err) {
      cb(new Error(res.body.toString()), null)
    } else {
      cb(undefined, res.body)
    }
  }

  handleNewSourceRequest(msg: Message) {
    //    console.log('brand new incoming source request!', msg)
    this.incoming.set(msg.header.id, msg)

    const { stream, encoding } = this.requestHandlerFn(msg)
    this.addSendStream(msg.header.id, encoding, stream)
  }

  handleNewAsyncRequest(msg: Message) {
    //    console.log('brand new incoming async request!', msg)
    this.incoming.set(msg.header.id, msg)

    // TODO: support cancellation, so the cb below doesn't do anything
    this.requestHandlerFn(msg, (err: Error | null, enc: Encoding, data: MessageBody) => {
      let res
      if (err) {
        res = {
          header: {
            id: -msg.header.id,
            length: -1,
            encoding: Encoding.Json,
            stream: false,
            err: !!err
          },
          body: err.message
        }
      } else if (enc && data) {
        res = {
          header: {
            id: -msg.header.id,
            length: -1,
            encoding: enc,
            stream: false,
            err: !!err
          },
          body: data
        }
      } else {
        // TODO: malformed! no error, but missing encoding and/or body!
        return
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
    const id = String(Math.random()).substring(5)

    // make the sink side of this through a pull-reader
    const reader = Reader<Buffer>()
    reader(read)

    return (abort: pull.Abort, cb: pull.SourceCallback<Message>) => {
      if (abort) return reader.abort(abort)

      // read header
      //      console.log(id, 'reading 9 bytes..')
      reader.read(9, (err, buf) => {
        if (err) return cb(err)
        const header = decodeHeader(buf)
        //        console.log(id, 'header', header)

        // read body
        reader.read(header.length, (err, buf) => {
          if (err) return cb(err)
          //          console.log(id, 'incoming', header, buf.toString())
          try {
            const body = decodeMessageBody(buf, header.encoding)
            //            console.log(id, 'decoded', body)
            cb(null, { header, body })
          } catch (e) {
            cb(e)
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
  } else if (typeof data === 'string') {
    return Buffer.from(data)
  } else if (Buffer.isBuffer(data)) {
    return data
  } else {
    throw new Error('invalid data argument')
  }
}

function encodeThrough() {
  return pull.map(encodeMessage)
}

export default MuxRpc
