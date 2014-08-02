var tape = require('tape')
var concat = require('concat-stream')
var protocol = require('../')

tape('encode + decode changes', function(t) {
  var p = protocol(function(type, stream) {
    t.same(type, protocol.CHANGES)
    stream.pipe(concat(function(changes) {
      t.same(changes.length, 1)
      t.same(changes[0], {
        key: 'key',
        from: 0,
        to: 1,
        change: 1,
        value: new Buffer('hello')
      })
      t.end()
    }))
  })

  var changes = p.createChangesStream()

  changes.write({
    key: 'key',
    from: 0,
    to: 1,
    change: 1,
    value: new Buffer('hello')
  })

  changes.end()

  p.pipe(p)
})

tape('encode + decode blob', function(t) {
  var p = protocol(function(type, stream) {
    t.same(type, protocol.BLOB)
    stream.pipe(concat(function(data) {
      t.same(data.length, 11)
      t.same(data, new Buffer('hello world'))
      t.end()
    }))
  })

  var blob = p.createBlobStream(11)

  blob.write('hello ')
  blob.write('world')
  blob.end()

  p.pipe(p)
})

tape('encode + decode mixed blobs', function(t) {
  var expects = [
    new Buffer('hello world'),
    new Buffer('HELLO WORLD')
  ]

  t.plan(6)

  var p = protocol(function(type, stream) {
    t.same(type, protocol.BLOB)
    var e = expects.shift()
    stream.pipe(concat(function(data) {
      t.same(data.length, e.length)
      t.same(data, e)
    }))
  })

  var b1 = p.createBlobStream(11)
  var b2 = p.createBlobStream(11)

  b1.write('hello ')
  b2.write('HELLO ')
  b1.write('world')
  b2.write('WORLD ')
  b1.end()
  b2.end()

  p.pipe(p)
})

tape('encode + decode blob and changes', function(t) {
  t.plan(4)

  var p = protocol(function(type, stream) {
    if (type === protocol.BLOB) {
      stream.pipe(concat(function(data) {
        t.same(data.length, 11)
        t.same(data, new Buffer('hello world'))
      }))
    } else if (type === protocol.CHANGES) {
      stream.pipe(concat(function(changes) {
        t.same(changes.length, 1)
        t.same(changes[0], {
          key: 'key',
          from: 0,
          to: 1,
          change: 1,
          value: new Buffer('hello')
        })
      }))
    } else {
      t.ok(false)
    }
  })

  var blob = p.createBlobStream(11)

  blob.write('hello ')
  blob.write('world')
  blob.end()

  var changes = p.createChangesStream()

  changes.write({
    key: 'key',
    from: 0,
    to: 1,
    change: 1,
    value: new Buffer('hello')
  })

  changes.end()

  p.pipe(p)
})