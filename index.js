var stream = require('stream')
var varint = require('varint')
var util = require('util')

var PING = new Buffer('ping')

var pool = new Buffer(5012)
var used = 0
var noop = function() {}

var Sink = function(parent, cb) {
  this._parent = parent
  if (cb) this.once('finish', cb)
  stream.Writable.call(this)
}

util.inherits(Sink, stream.Writable)

Sink.prototype._write = function(data, enc, cb) {
  this._parent._push(data, cb)
}

var Protocol = function() {
  if (!(this instanceof Protocol)) return new Protocol()
  stream.Duplex.call(this)

  var self = this

  this.conflicts = 0
  this.blobs = 0
  this.documents = 0
  this.bytes = 0
  this.destroyed = false

  this._msbs = 2
  this._missing = 0
  this._buffer = null
  this._stream = null

  this._headerPointer = 0
  this._headerBuffer = new Buffer(50)
  this._ondrain = null
  this._ended = false
  this._finalized = false

  this._cb = null
  this._nextCalled = false
  this._next = function() {
    self._nextCalled = true
    if (!self._cb) return
    var cb = self._cb
    self._cb = null
    cb()
  }

  this.on('finish', function() {
    this._end() // no half open
  })
}

util.inherits(Protocol, stream.Duplex)

// decode

Protocol.prototype._write = function(data, enc, cb) {
  if (this.destroyed) return cb()

  if (this._missing) return this._forward(data, cb)

  for (var i = 0; i < data.length; i++) {
    if (!(data[i] & 0x80)) this._msbs--

    this._headerBuffer[this._headerPointer++] = data[i]
    if (this._msbs) continue

    if (i === data.length-1) this._onheader(cb)
    else this._onheader(this._rewrite(data.slice(i+1), cb))
    return
  }

  cb()
}

Protocol.prototype.destroy = function(err) {
  if (this.destroyed) return
  this.destroyed = true
  if (err) this.emit('error', err)
  this.emit('close')
}

Protocol.prototype._forward = function(data, cb) {
  if (this.destroyed) return cb()

  if (data.length > this._missing) {
    var overflow = data.slice(this._missing)
    data = data.slice(0, this._missing)
    cb = this._rewrite(overflow, cb)
  }

  this.bytes += data.length
  this.emit('update')

  if (this._buffer) {
    data.copy(this._buffer, this._buffer.length - this._missing)
    this._missing -= data.length

    if (!this._missing) return this._onbufferdone(cb)
    return cb()
  }

  this._missing -= data.length

  if (this._missing) return this._stream.write(data, cb)

  this._stream.write(data)
  this._stream.end()
  this._onstreamdone(cb)
}

Protocol.prototype._onheader = function(cb) {
  if (this.destroyed) return cb()

  this._headerPointer = 0
  this._msbs = 2

  this._type = varint.decode(this._headerBuffer)
  this._missing = varint.decode(this._headerBuffer, varint.decode.bytesRead)

  switch (this._type) {
    case 0:
    case 1:
    case 2:
    case 4:
    this._buffer = new Buffer(this._missing)
    return cb()

    case 3:
    this._nextCalled = false
    this._stream = new stream.PassThrough()
    this.blobs++
    this.emit('update')
    if (!this.emit('blob', this._stream, this._next)) {
      this._stream.resume()
      this._next()
    }
    return cb()

    case 5:
    this.emit('ping')
    return cb()

    case 6:
    cb = this._finalizer(cb)
    this.emit('finalize', cb) || cb()
    return

    default:
    this._nextCalled = true
    this._stream = new stream.PassThrough()
    this._stream.resume()
    cb()
  }
}

Protocol.prototype._onstreamdone = function(cb) {
  if (this.destroyed) return cb()

  this._stream = null
  if (this._nextCalled) return cb()
  this._cb = cb
}

Protocol.prototype._onbufferdone = function(cb) {
  if (this.destroyed) return cb()

  var buf = this._buffer
  this._buffer = null

  switch (this._type) {
    case 0:
    return this.emit('meta', JSON.parse(buf.toString()), cb) || cb()
    case 1:
    this.documents++
    this.emit('update')
    return this.emit('document', JSON.parse(buf.toString()), cb) || cb()
    case 2:
    this.documents++
    this.emit('update')
    return this.emit('protobuf', buf, cb) || cb()
    case 4:
    this.conflicts++
    this.emit('update')
    return this.emit('conflict', JSON.parse(buf.toString()), cb) || cb()
  }

  cb()
}

Protocol.prototype._rewrite = function(data, cb) {
  var self = this
  return function(err) {
    if (err) return cb(err)
    self._write(data, null, cb)
  }
}

// encode

Protocol.prototype.meta = function(data, cb) {
  var buf = new Buffer(JSON.stringify(data))
  this._header(0, buf.length)
  this._push(buf, cb || noop)
}

Protocol.prototype.document = function(doc, cb) {
  var buf = new Buffer(JSON.stringify(doc))
  this.documents++
  this._header(1, buf.length)
  this._push(buf, cb || noop)
}

Protocol.prototype.protobuf = function(buf, cb) {
  this.documents++
  this._header(2, buf.length)
  this._push(buf, cb || noop)
}

Protocol.prototype.blob = function(length, cb) {
  this.blobs++
  this._header(3, length)
  this.emit('update')
  return new Sink(this, cb)
}

Protocol.prototype.conflict = function(message, cb) {
  var buf = new Buffer(JSON.stringify(message))
  this.conflicts++
  this._header(4, buf.length)
  this._push(buf, cb || noop)
}

Protocol.prototype.ping = function(cb) {
  this._header(5, 0)
  if (cb) cb()
}

Protocol.prototype.finalize = function(cb) {
  this._finalized = true
  this._header(6, 0)
  if (cb) cb()
}

Protocol.prototype._push = function(data, cb) {
  if (this._ended) return cb(new Error('Stream has been finalized'))
  if (this.push(data)) cb()
  else this._ondrain = cb
  this.bytes += data.length
  this.emit('update')
}

Protocol.prototype._header = function(type, len) {
  if (this._ended) return

  if (pool.length - used < 50) {
    used = 0
    pool = new Buffer(5012)
  }

  var start = used

  varint.encode(type, pool, used)
  used += varint.encode.bytesWritten

  varint.encode(len, pool, used)
  used += varint.encode.bytesWritten

  this.push(pool.slice(start, used))
}

Protocol.prototype._end = function() {
  if (this._ended) return
  this._ended = true
  this.push(null)
}

Protocol.prototype._finalizer = function(cb) {
  var self = this
  return function(err) {
    self._end()
    cb(err)
  }
}

Protocol.prototype._read = function() {
  if (!this._ondrain) return
  var ondrain = this._ondrain
  this._ondrain = null
  ondrain()
}

module.exports = Protocol