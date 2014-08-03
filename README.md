# dat-replication-protocol

Streaming implementation of the dat replication protocol

```
npm install dat-replication-protocol
```

[![build status](http://img.shields.io/travis/mafintosh/dat-replication-protocol.svg?style=flat)](http://travis-ci.org/mafintosh/dat-replication-protocol)
![dat](http://img.shields.io/badge/Development%20sponsored%20by-dat-green.svg?style=flat)

## Usage

``` js
var protocol = require('dat-replication-protocol')

var decode = protocol.decode()
var encode = protocol.encode()

decode.change(function(change, cb) {
  // received a change
  cb()
})

decode.blob(function(blob, cb) {
  // received a blob stream
  blob.on('data', function(data) {
    console.log(data)
  })
  blob.on('end', function() {
    cb()
  })
})

decode.finalize(function(cb) {
  // should finalize stuff
  cb()
})

// write changes data
encode.change({
  key: 'some-row-key',
  change: 0,
  from: 0,
  to: 1,
  value: new Buffer('some binary value')
}, functoin() {
  console.log('change was flushed')
})

var blob = encode.blob(12) // 12 is the length of the blob

blob.write('hello ')
blob.write('world\n')
blob.end()

encode.finalize() // end the encode stream

// set up the pipeline
e.pipe(d)
```

## Wire format

Basically all changes and blobs are sent as multibuffers (varint prefixed).

```
--------------------------------------------------
|  varint length  |  single byte id  |  payload  |
--------------------------------------------------
```

Since blobs can be large they are treated as streams.

## License

MIT