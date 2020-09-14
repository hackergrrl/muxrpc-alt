declare module 'pull-reader' {
  import pull = require('pull-stream')

  interface Reader<T> extends pull.Sink<T> {
    read(bytes: number, cb: (err: pull.Abort, data: T) => void): void
    abort(err: pull.Abort): void
  }

  function Reader<T>(): Reader<T>;

  export = Reader;
}

