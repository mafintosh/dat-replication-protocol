var tape = require('tape')
var concat = require('concat-stream')
var protocol = require('../')

tape('encode + decode changes', function(t) {
  var e = protocol.encode()
  var d = protocol.decode()

  d.change(function(change) {
    t.same(change, {
      key: 'key',
      from: 0,
      to: 1,
      change: 1,
      value: new Buffer('hello'),
      subset: ''
    })
    t.end()
  })

  e.change({
    key: 'key',
    from: 0,
    to: 1,
    change: 1,
    value: new Buffer('hello')
  })

  e.pipe(d)
})

tape('encode + decode blob', function(t) {
  var e = protocol.encode()
  var d = protocol.decode()

  d.blob(function(blob) {
    blob.pipe(concat(function(data) {
      t.same(data.length, 11)
      t.same(data, new Buffer('hello world'))
      t.end()
    }))
  })

  var blob = e.blob(11)

  blob.write('hello ')
  blob.write('world')
  blob.end()

  e.pipe(d)
})

tape('encode + decode mixed blobs', function(t) {
  var expects = [
    new Buffer('hello world'),
    new Buffer('HELLO WORLD')
  ]

  t.plan(4)

  var e = protocol.encode()
  var d = protocol.decode()

  d.blob(function(blob, cb) {
    var e = expects.shift()
    blob.pipe(concat(function(data) {
      t.same(data.length, e.length)
      t.same(data, e)
      cb()
    }))
  })

  var b1 = e.blob(11)
  var b2 = e.blob(11)

  b1.write('hello ')
  b2.write('HELLO ')
  b1.write('world')
  b2.write('WORLD ')
  b1.end()
  b2.end()

  e.pipe(d)
})

tape('encode + decode blob and changes', function(t) {
  t.plan(3)

  var e = protocol.encode()
  var d = protocol.decode()

  d.blob(function(blob, cb) {
    blob.pipe(concat(function(data) {
      t.same(data.length, 11)
      t.same(data, new Buffer('hello world'))
      cb()
    }))
  })

  d.change(function(change, cb) {
    t.same(change, {
      key: 'key',
      from: 0,
      to: 1,
      change: 1,
      value: new Buffer('hello'),
      subset: ''
    })
    cb()
  })

  var blob = e.blob(11)

  blob.write('hello ')
  blob.write('world')
  blob.end()

  e.change({
    key: 'key',
    from: 0,
    to: 1,
    change: 1,
    value: new Buffer('hello')
  })

  e.pipe(d)
})