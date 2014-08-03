var protocol = require('./')

var encode = protocol.encode()
var decode = protocol.decode()

encode.change({
  key: 'lol1',
  change: 1,
  from: 0,
  to: 1,
  value: new Buffer('val')
})

encode.change({
  key: 'lol',
  change: 1,
  from: 0,
  to: 1,
  value: new Buffer('val')
})

var b1 = encode.blob(11, function() {
  console.log('blob was flushed')
})

b1.write('hello ')
b1.end('world')

encode.change({
  key: 'lol',
  change: 1,
  from: 0,
  to: 1,
  value: new Buffer('val')
}, function() {
  console.log('change was flushed')
})

decode.change(function(change, cb) {
  console.log(change)
  cb()
})

decode.blob(function(blob, cb) {
  blob.on('data', function(data) {
    console.log(data)
  })
  blob.on('end', function() {
    cb()
  })
})

encode.pipe(decode)
