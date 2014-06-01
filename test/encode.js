var tape = require('tape')
var concat = require('concat-stream')
var protocol = require('../')

tape('meta', function(t) {
  var p = protocol()

  p.pipe(concat(function(data) {
    t.same(data[0], 0, 'id')
    t.same(data[1], 12, 'length')
    t.same(data.slice(2).toString(), '{"change":1}', 'payload')
    t.end()
  }))

  p.meta({change:1})
  p.end()
})

tape('document', function(t) {
  var p = protocol()

  p.pipe(concat(function(data) {
    t.same(data[0], 1, 'id')
    t.same(data[1], 17, 'length')
    t.same(data.slice(2).toString(), '{"hello":"world"}', 'payload')
    t.end()
  }))

  p.document({hello:'world'})
  p.end()
})

tape('protobuf', function(t) {
  var p = protocol()

  p.pipe(concat(function(data) {
    t.same(data[0], 2, 'id')
    t.same(data[1], 18, 'length')
    t.same(data.slice(2).toString(), 'should be protobuf', 'payload')
    t.end()
  }))

  p.protobuf(new Buffer('should be protobuf'))
  p.end()
})

tape('blob', function(t) {
  var p = protocol()

  p.pipe(concat(function(data) {
    t.same(data[0], 3, 'id')
    t.same(data[1], 11, 'length')
    t.same(data.slice(2).toString(), 'hello world', 'payload')
    t.end()
  }))

  var bl = p.blob(11)

  bl.write('hello')
  bl.write(' ')
  bl.write('world')

  p.end()
})