export type MessageBody = Buffer | string | object

export enum Encoding {
  Binary = 'binary',
  Utf8 = 'utf8',
  Json = 'json'
}

export interface MessageHeader {
  id: number,
  length: number,
  encoding: Encoding,
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

export type RequestHandlerCb = (msg: Message, cb: (err: Error | null, enc: Encoding, res: MessageBody) => void) => void
