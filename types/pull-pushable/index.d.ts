declare module 'pull-pushable' {
  import pull = require('pull-stream')

  interface Pushable<T> extends pull.Source<T> {
    push(data: T): void
  }

  function Pushable<T>(separated: boolean): Pushable<T>;

  export = Pushable;
}
