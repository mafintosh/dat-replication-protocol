var stream = require('stream')
var varint = require('varint')
var util = require('util')
var messages = require('./messages')

var BlobStream = function(parent) {
  stream.Readable.call(this)

  this.destroyed = false
  this._ondrain = null
  this._parent = parent

  this.on('end', this._read)
}

util.inherits(BlobStream, stream.Readable)

BlobStream.prototype.destroy = function(err) {
  if (this.destroyed) return
  this.destroyed = true
  if (err) this.emit('error', err)
  this.emit('close')
  this._parent.destroy()
}

var compose = function(a,b) {
  return function() {
    a()
    b()
  }
}

BlobStream.prototype._push = function(data, cb) {
  if (this.push(data)) cb()
  else this._ondrain = this._ondrain ? compose(this._ondrain, cb) : cb
}

BlobStream.prototype._end = function() {
  this.push(null)
}

BlobStream.prototype._read = function() {
  var ondrain = this._ondrain
  this._ondrain = null
  if (ondrain) ondrain()
}

var defaultChange = function(change, cb) {
  cb()
}

var defaultBlob = function(stream, cb) {
  stream.resume()
  cb()
}

var Decoder = function() {
  if (!(this instanceof Decoder)) return new Decoder()
  stream.Writable.call(this)

  this.bytes = 0
  this.changes = 0
  this.blobs = 0

  this._pending = 0
  this._onflush = null

  this._buffer = null
  this._blob = null

  this._header = new Buffer(50)
  this._ptr = 0
  this._id = 0
  this._missing = 0

  this._onchange = defaultChange
  this._onblob = defaultBlob

  var self = this

  this._up = function() {
    self._pending++
    return self._down
  }

  this._down = function() {
    if (--self._pending) return
    var onflush = self._onflush
    self._onflush = null
    if (onflush) onflush()
  }
}

util.inherits(Decoder, stream.Writable)

Decoder.prototype.change = function(fn) {
  this._onchange = fn
}

Decoder.prototype.blob = function(fn) {
  this._onblob = fn
}

Decoder.prototype._write = function(data, enc, cb) {
  this.bytes += data.length
  this._overflow = data
  this._consume(cb)
}

Decoder.prototype._consume = function(cb) {
  while (this._overflow && !this.destroyed && this._pending <= 0) {
    switch (this._id) {
      case 0:
      this._overflow = this._onheader(this._overflow)
      break

      case 1:
      this._overflow = this._onchangedata(this._overflow)
      break

      case 2:
      this._overflow = this._onblobdata(this._overflow)
      break

      default:
      this.destroy(new Error('Protocol error, unknown type: '+this._id))
      return
    }
  }

  if (this.destroyed) return

  if (this._pending <= 0) cb()
  else this._onflush = cb
}

Decoder.prototype._onblobend = function() {
  this._pending++
  this._blob._end()
  this._blob = null
  this._id = 0
  this._ptr = 0
}

Decoder.prototype._onblobdata = function(data) {
  if (!this._blob) {
    this.blobs++
    this._blob = new BlobStream(this)
    this._onblob(this._blob, this._down)
  }

  if (data.length === this._missing) {
    this._blob._push(data, this._up())
    this._onblobend()
    return null
  }

  if (data.length < this._missing) {
    this._missing -= data.length
    this._blob._push(data, this._up())
    return null
  }

  var overflow = data.slice(this._missing)
  this._blob._push(data.slice(0, this._missing), this._up())
  this._onblobend()
  return overflow
}


Decoder.prototype._onchangeend = function(data) {
  this._id = 0
  this._ptr = 0
  this._buffer = null

  data = messages.Change.decode(data)

  this.changes++
  this._onchange(data, this._up())
}

Decoder.prototype._onchangedata = function(data) {
  if (!this._buffer) { // fast track
    if (data.length === this._missing) {
      this._onchangeend(data)
      return null
    }

    if (data.length > this._missing) {
      var overflow = data.slice(this._missing)
      this._onchangeend(data.slice(0, this._missing))
      return overflow
    }

    this._buffer = new Buffer(this._missing)
  }

  if (data.length < this._missing) {
    data.copy(this._buffer, this._ptr)
    this._ptr += data.length
    this._missing -= data.length
    return null
  }

  if (data.length === this._missing) {
    data.copy(this._buffer, this._ptr)
    this._onchangeend(this._buffer)
    return null
  }

  var overflow = data.slice(this._missing)
  data.copy(this._buffer, this._ptr)
  this._onchangeend(this._buffer)
  return overflow
}

Decoder.prototype._onheader = function(data) {
  for (var i = 0; i < data.length; i++) {
    this._header[this._ptr++] = data[i]
    if (this._ptr > 1 && !(this._header[this._ptr-2] & 0x80)) {
      this._missing = varint.decode(this._header)-1
      this._id = data[i]
      this._ptr = 0
      return data.slice(i+1)
    }
  }
  return null
}

module.exports = Decoder