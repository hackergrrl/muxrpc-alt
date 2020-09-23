declare module 'pull-pushable' {
  import pull = require('pull-stream')

  interface Pushable<T> {
    push(data: T): void

    source: pull.Source<T>
  }

  function Pushable<T>(separated: boolean): Pushable<T>;

  export = Pushable;
}
