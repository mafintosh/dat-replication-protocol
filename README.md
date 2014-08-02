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

var p = protocol(function(type, stream) {
  if (type === protocol.CHANGES) {
    // receiving the changes stream
    stream.on('data', function(change) {
      console.log('change:', change)
    })
  }
  if (type === protocol.BLOB) {
    // receiving a blob stream
    stream.pipe(process.stdout)
  }
})

var changes = p.createChangesStream()

// write changes data to this stream
changes.write({
  key: 'some-row-key',
  change: 0,
  from: 0,
  to: 1,
  value: new Buffer('some binary value')
})

var blob = p.createBlobStream(12) // 12 is the length of the blob

blob.write('hello ')
blob.write('world\n')
blob.end()

// for testing lets just pipe it to ourselves
p.pipe(p)
```

This works similarly to the [multiplex module](https://github.com/maxogden/multiplex) except
this uses length prefixed streams for the blobs streams

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