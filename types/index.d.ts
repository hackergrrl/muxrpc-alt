type MessageBody = Buffer | string

interface MessageHeader {
  id: number,
  length: number,
  encoding: string,
  err?: Error | boolean,
  stream: boolean
}

interface Message {
  header: MessageHeader,
  body: MessageBody
}

interface RequestMessage extends Message {
  cb: (err?: Error, res?: any) => void
}

type RequestHandlerCb = (msg: Message, cb: (err: Error, res: Message) => void) => void
