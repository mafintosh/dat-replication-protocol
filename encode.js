var stream = require('stream')
var varint = require('varint')
var util = require('util')
var messages = require('./messages')

var POOL = new Buffer(65536)
var used = 0

var noop = function() {}

var BlobStream = function(parent) {
  stream.Writable.call(this)

  this.destroyed = false
  this.corked = 0
  this._parent = parent
  this._wargs = null
}

util.inherits(BlobStream, stream.Writable)

BlobStream.prototype.destroy = function(err) {
  if (this.destroyed) return
  this.destroyed = true
  if (err) this.emit('error', err)
  this.emit('close')
  if (this._parent) this._parent.destroy()
}

BlobStream.prototype.uncork = function() {
  if (!this.corked || --this.corked) return
  var wargs = this._wargs
  this._wargs = null
  if (wargs) this._write.apply(this, wargs)
}

BlobStream.prototype.cork = function() {
  this.corked++
}

BlobStream.prototype._write = function(data, enc, cb) {
  if (this.corked) this._wargs = arguments
  else this._parent._push(data, cb)
}

var Encoder = function() {
  if (!(this instanceof Encoder)) return new Encoder()
  stream.Readable.call(this)

  this.destroyed = false
  this.bytes = 0
  this.changes = 0
  this.blobs = 0

  this._blobs = []
  this._changes = []
  this._ondrain = null
}

util.inherits(Encoder, stream.Readable)

var compose = function(a,b) {
  return function() {
    a()
    b()
  }
}

Encoder.prototype.destroy = function(err) {
  if (this.destroyed) return
  this.destroyed = true
  while (this._blobs.length) this._blobs.shift().destroy()
  if (err) this.emit('error', err)
  this.emit('close')
}

Encoder.prototype.blob = function(len, cb) {
  if (this.destroyed) return null
  if (!len) throw new Error('Length is required')

  this.blobs++

  var self = this
  var ws = new BlobStream(this)
  var header = this._header(len, 2)

  if (this._blobs.length) ws.cork()

  this._blobs.push(ws)

  ws.write(header)
  ws.on('finish', function() {
    if (self._blobs.shift() !== ws) throw new Error('Blob assertion failed')
    if (self._blobs.length) self._blobs[0].uncork()
    else while (!self._blobs.length && self._changes.length) self.change.apply(self, self._changes.shift())
    if (cb) cb()
  })

  return ws
}

Encoder.prototype.change = function(change, cb) {
  if (this.destroyed) return
  if (this._blobs.length) {
    this._changes.push(arguments)
    return
  }

  this.changes++

  change = messages.Change.encode(change)
  var header = this._header(change.length, 1)

  this.bytes += header.length
  this.push(header)
  this._push(change, cb || noop)
}

Encoder.prototype.finalize = function(cb) {
  if (!this._readableState.ended) this.push(null)
  if (cb) cb()
}

Encoder.prototype._header = function(len, id) {
  if (POOL.length - used < 30) {
    POOL = new Buffer(POOL.length)
    used = 0
  }

  var offset = used

  varint.encode(len+1, POOL, used)
  used += varint.encode.bytes
  POOL[used++] = id

  return POOL.slice(offset, used)
}

Encoder.prototype._push = function(data, cb) {
  if (this.destroyed) return
  this.bytes += data.length

  if (this.push(data)) cb()
  else this._ondrain = this._ondrain ? compose(this._ondrain, cb) : cb
}

Encoder.prototype._read = function() {
  var ondrain = this._ondrain
  this._ondrain = null
  if (ondrain) ondrain()
}

module.exports = Encoder