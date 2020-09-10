const pull = require('pull-stream')
const muxrpc = require('.')

const rpc = muxrpc()

const header = {
  name: ["getPeerInfo"],
  type: "async",
  args: [{id: "@FCX/tsDLpubCPKKfIrw4gc+SQkHcaD17s7GI6i/ziWY=.ed25519"}]
}
rpc.request(header, 'json', (err, info) => {})

rpc.onRequest(function (req) {
  console.log('got req', req)
  // { name, type, args, encoding }
  // also one of:
  //  - cb
  //  - sink
  //  - source
  //  - sink, source
})

pull(
  rpc.stream,
  rpc.stream,
  rpc.stream
)
