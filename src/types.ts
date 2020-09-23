import pull from 'pull-stream'

export type MessageBody = Buffer | string | object | boolean | number | Array<any>

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
  header: MessageHeader,
  body: {
    name: string,
    type: string,
    args: Array<string>
  }
}

export interface AsyncMessage extends Message {
  cb: (err?: Error, res?: any) => void
}

export interface SourceMessage extends Message {
  source: pull.Source<any>
}

export type RequestHandlerCb = any
