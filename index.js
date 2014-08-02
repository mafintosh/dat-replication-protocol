var stream = require('stream')
var util = require('util')
var varint = require('varint')
var messages = require('./messages')

var noop = function() {}

var POOL = new Buffer(65536)
var used = 0

// read proxy

var ReadStream = function(parent, objectMode) {
  stream.Readable.call(this, objectMode ? {objectMode:true, highWaterMark:16} : null)

  this.destroyed = false
  this._parent = parent
  this._onflush = null
}

util.inherits(ReadStream, stream.Readable)

ReadStream.prototype.destroy = function(err) {
  if (this.destroyed) return
  this.destroyed = true
  if (err) this.emit('error', err)
  this.emit('close')
  this._parent.destroy()
}

ReadStream.prototype._push = function(data, cb) {
  if (this.push(data)) cb()
  else this._onflush = cb
}

ReadStream.prototype._end = function() {
  this.push(null)
}

ReadStream.prototype._read = function() {
  var onflush = this._onflush
  this._onflush = null
  if (onflush) onflush()
}

// write proxy

var WriteStream = function(parent, objectMode) {
  stream.Writable.call(this, objectMode ? {objectMode:true, highWaterMark:16} : null)

  this.corked = 0
  this.destroyed = false
  this._cargs = null
  this._parent = parent
  this._objectMode = objectMode
}

util.inherits(WriteStream, stream.Writable)

WriteStream.prototype.destroy = function(err) {
  if (this.destroyed) return
  this.destroyed = true
  if (err) this.emit('error', err)
  this.emit('close')
  this._parent.destroy()
}

WriteStream.prototype.cork = function() {
  this.corked++
}

WriteStream.prototype.uncork = function() {
  if (!this.corked || --this.corked) return

  var args = this._cargs
  this._cargs = null
  if (args) this._write.apply(this, args)
}

WriteStream.prototype._write = function(data, enc, cb) {
  if (this.corked) this._cargs = arguments
  else if (this._objectMode) this._parent._pushChange(data, cb)
  else this._parent._pushBlob(data, cb)
}

// protocol stream

var Protocol = function(onstream) {
  if (!(this instanceof Protocol)) return new Protocol(onstream)
  stream.Duplex.call(this)

  this.destroyed = false

  this.changesWritten = 0
  this.blobsWritten = 0
  this.bytesWritten = 0

  this.changesRead = 0
  this.blobsRead = 0
  this.bytesRead = 0

  this._rblob = null
  this._rchanges = null

  this._wchanges = null
  this._wblobs = []

  this._onreadflush = null
  this._onwriteflush = null
  this._onstream = onstream || noop

  this._id = 0
  this._missing = 0
  this._buffer = null
  this._bufferh = new Buffer(50)
  this._ptr = 0

  this._pending = 0

  var self = this
  var flush = function() {
    if (--self._pending) return
    var onflush = self._onwriteflush
    self._onwriteflush = null
    if (onflush) onflush()
  }

  this._flush = flush
}

util.inherits(Protocol, stream.Duplex)

Protocol.CHANGES = 1
Protocol.BLOB = 2

// public interface

Protocol.prototype.createBlobStream = function(length) {
  if (!length) throw new Error('Length is required')

  var ws = new WriteStream(this, false)

  if (this._wchanges) this._wchanges.cork()
  if (this._wblobs.length) ws.cork()

  // we need to wait for the stream to be uncorked before writing the header
  // this is a bit hackish but it works
  ws.write(this._header(Protocol.BLOB, length))

  this.blobsWritten++
  this._wblobs.push(ws)

  var self = this
  ws.on('finish', function() {
    if (self._wblobs.shift() !== ws) throw new Error('Blob assertion failed')
    if (self._wblobs.length) self._wblobs[0].uncork()
    if (self._wchanges) self._wchanges.uncork()
  })

  return ws
}

Protocol.prototype.createChangesStream = function() {
  if (this._wchanges) throw new Error('Only one changes stream can be created')
  var ws = new WriteStream(this, true)
  this._wchanges = ws
  if (this._wblobs.length) ws.cork()

  var self = this
  ws.on('finish', function() {
    if (self._readableState.ended) return
    var end = self._header(Protocol.CHANGES, 0)
    self.bytesWritten += end.length
    self.push(end)
  })

  return ws
}

Protocol.prototype.destroy = function(err) {
  if (this.destroyed) return
  this.destroyed = true

  if (this._wchanges) this._wchanges.destroy()
  if (this._rchanges) this._rchanges.destroy()

  for (var i = 0; i < this._wblobs.length; i++) this._wblobs[i].destroy()
  if (this._rblob) this._rblob.destroy()

  if (err) this.emit('error', err)
  this.emit('close')
}

Protocol.prototype.finalize = function() {
  this.push(null)
}

// encoder

Protocol.prototype._header = function(id, len) {
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

Protocol.prototype._pushChange = function(data, cb) {
  data = messages.Change.encode(data)
  var header = this._header(Protocol.CHANGES, data.length)

  this.changesWritten++
  this.bytesWritten += header.length
  this.push(header)
  this._push(data, cb)
}

Protocol.prototype._pushBlob = function(data, cb) {
  this._push(data, cb)
}

Protocol.prototype._push = function(data, cb) {
  this.bytesWritten += data.length
  if (this.push(data)) cb()
  else this._onreadflush = cb
}

Protocol.prototype._read = function() {
  var onflush = this._onreadflush
  this._onreadflush = null
  if (onflush) onflush()
}

// decoder

Protocol.prototype._write = function(data, enc, cb) {
  this.bytesRead += data.length

  while (data && data.length && !this.destroyed) {
    switch (this._id) {
      case 0:
      data = this._onheader(data)
      // handle special case - end of changes
      if (this._id === 1 && !this._missing) this._onchangedata(null)
      break

      case 1:
      data = this._onchanges(data)
      break

      case 2:
      data = this._onblob(data)
      break

      default:
      this.destroy(new Error('Protocol error, unknown type: '+this._id))
      return
    }
  }

  if (!this._pending) cb()
  else this._onwriteflush = cb
}

Protocol.prototype._onchangedata = function(data) {
  this._id = 0
  this._ptr = 0
  this._buffer = null

  if (data === null) {
    this._rchanges.push(null)
    return
  }

  data = messages.Change.decode(data)
  this.changesRead++
  this._rchanges._push(data, this._up())
}

Protocol.prototype._onblobend = function() {
  this._rblob._end()
  this._id = 0
  this._ptr = 0
  this._rblob = null
}

Protocol.prototype._onchanges = function(data) {
  if (!this._rchanges) {
    this._rchanges = new ReadStream(this, true)
    this._onstream(Protocol.CHANGES, this._rchanges)
  }

  if (!this._buffer) { // fast track
    if (data.length === this._missing) {
      this._onchangedata(data)
      return null
    }

    if (data.length > this._missing) {
      var overflow = data.slice(this._missing)
      this._onchangedata(data.slice(0, this._missing))
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
    this._onchangedata(this._buffer)
    return null
  }

  var overflow = data.slice(this._missing)
  data.copy(this._buffer, this._ptr)
  this._onchangedata(this._buffer)
  return overflow
}

Protocol.prototype._onblob = function(data) {
  if (!this._rblob) {
    this.blobsRead++
    this._rblob = new ReadStream(this, false)
    this._onstream(Protocol.BLOB, this._rblob)
  }

  if (data.length === this._missing) {
    this._rblob._push(data, this._up())
    this._onblobend()
    return null
  }

  if (data.length < this._missing) {
    this._missing -= data.length
    this._rblob._push(data, this._up())
    return null
  }

  var overflow = data.slice(this._missing)
  this._rblob._push(data.slice(0, this._missing), this._up())
  this._onblobend()
  return overflow
}

Protocol.prototype._onheader = function(data) {
  for (var i = 0; i < data.length; i++) {
    this._bufferh[this._ptr++] = data[i]
    if (this._ptr > 1 && !(this._bufferh[this._ptr-2] & 0x80)) {
      this._missing = varint.decode(this._bufferh)-1
      this._id = data[i]
      this._ptr = 0
      return data.slice(i+1)
    }
  }
  return null
}

Protocol.prototype._up = function() {
  this._pending++
  return this._flush
}

module.exports = Protocol