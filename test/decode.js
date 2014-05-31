var tape = require('tape')
var concat = require('concat-stream')
var through = require('through2')
var protocol = require('../')

var input = function() {
  var p = protocol()

  p.meta({change:1})
  p.ping()
  p.warn({conflict:true})
  p.document({hello:'world'})
  var bl = p.blob(11)
  bl.write('hello ')
  bl.end('world')
  p.protobuf(new Buffer('should be protobuf'))
  p.finalize()

  return p.pipe(through(function(data, enc, cb) {
    while (data.length) {
      var offset = 1+Math.floor(Math.random() * (data.length-1))
      this.push(data.slice(0, offset))
      data = data.slice(offset)
    }
    cb()
  }))
}

tape('meta', function(t) {
  var p = protocol()

  p.on('meta', function(meta) {
    t.same(meta, {change:1})
    t.end()
  })

  input().pipe(p)
})

tape('document', function(t) {
  var p = protocol()

  p.on('document', function(doc) {
    t.same(doc, {hello:'world'})
    t.end()
  })

  input().pipe(p)
})


tape('protobuf', function(t) {
  var p = protocol()

  p.on('protobuf', function(buf, cb) {
    t.ok(Buffer.isBuffer(buf), 'is buffer')
    t.same(buf, new Buffer('should be protobuf'))
    t.end()
  })

  input().pipe(p)
})

tape('blob', function(t) {
  var p = protocol()

  p.on('blob', function(stream, cb) {
    stream.pipe(concat(function(data) {
      t.same(data, new Buffer('hello world'))
      t.end()
    }))
  })

  input().pipe(p)
})

tape('multiple', function(t) {
  var p = protocol()

  var hadMeta = false
  var hadProto = false
  var hadDoc = false
  var hadBlob = false
  var hadWarn = false
  var hadPing = false

  p.on('meta', function(meta, cb) {
    hadMeta = true
    cb()
  })

  p.on('ping', function() {
    hadPing = true
  })

  p.on('warn', function(warning, cb) {
    hadWarn = true
    cb()
  })

  p.on('document', function(doc, cb) {
    hadDoc = true
    cb()
  })

  p.on('protobuf', function(buf, cb) {
    hadProto = true
    cb()
  })

  p.on('blob', function(stream, cb) {
    hadBlob = true
    stream.resume()
    cb()
  })

  p.on('finish', function() {
    t.ok(hadBlob, 'had blob')
    t.ok(hadProto, 'had protobuf')
    t.ok(hadMeta, 'had meta')
    t.ok(hadDoc, 'had document')
    t.ok(hadWarn, 'had warning')
    t.ok(hadPing, 'had ping')
    t.end()
  })

  input().pipe(p)
})