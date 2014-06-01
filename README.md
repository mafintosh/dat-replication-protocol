# dat-replication-protocol

Streaming implementation of the dat replication protocol

```
npm install dat-replication-protocol
```

[![build status](http://img.shields.io/travis/mafintosh/dat-replication-protocol.svg?style=flat)](http://travis-ci.org/mafintosh/dat-replication-protocol)
![dat](http://img.shields.io/badge/Development%20sponsored%20by-dat-green.svg?style=flat)

## Parsing

Pipe a stream to a protocol instance to parse it

``` js
var protocol = require('dat-replication-protocol')

var p = protocol()

p.on('conflict', function(conflict, cb) {
  console.log('conflict!', conflict)
  cb()
})

p.on('meta', function(meta, cb) {
  console.log('found meta info', meta)
  cb()
})

p.on('document', function(doc, cb) {
  console.log('found a document', doc)
  cb()
})

p.on('protobuf', function(buf, cb) {
  console.log('found a protobuf', buf)
  cb()
})

p.on('blob', function(blob, cb) {
  console.log('found a blob (stream)')
  blob.pipe(someWritableStream)
  cb()
})

someReadableStream.pipe(p)
```

If you omit a handler the callback is automatically called for you

## Producing

Pipe the protocol instance somewhere else and produce the packets you want to send

``` js
var p = protocol()

p.conflict({key:'some-key', version:42}, function() {
  console.log('conflict sent')
})

p.meta({change:10}, function() {
  console.log('meta info sent')
})

p.document({hello:'world'}, function() {
  console.log('document sent')
})

p.protobuf(new Buffer('should be protobuf'), function() {
  console.log('protobuf sent')
})

var blob = p.blob(11, function() { // note 11 is the length and is required
  console.log('blob sent')
})

blob.write('hello ')
blob.end('world')

p.pipe(someWritableStream)
```

Whenever a document,protobuf etc is being written/parsed a `transfer` event is emitted containing the type.
This is useful is you want to do progress monitoring etc.

## Protocol

The binary encoding of the protocol is as follows:

```
-------------------------------------------------------------
|  type as varint  |  payload length as varint  |  payload  |
-------------------------------------------------------------
```

A stream consists of a multiple packets that follow the above format.
Currently the following types are defined

type           | description
-------------- | ------------
0              | meta info (like schema, change number, etc)
1              | document encoded as JSON
2              | document encoded as protobuf
3              | blob (should be interpreted as a stream)
4              | conflict encoded as JSON (should contain key, version)
5              | ping (can be ignored)


## License

MIT
