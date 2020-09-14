export type MessageBody = Buffer | string

export interface MessageHeader {
  id: number,
  length: number,
  encoding: string,
  err?: Error | boolean,
  stream: boolean
}

export interface Message {
  header: MessageHeader,
  body: MessageBody
}

export interface RequestMessage extends Message {
  cb: (err?: Error, res?: any) => void
}

export type RequestHandlerCb = (msg: Message, cb: (err: Error, res: Message) => void) => void
