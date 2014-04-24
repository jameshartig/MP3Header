var MP3Frame = require('./MP3Frame.js'),
    http = require('http'),
    stream = require('stream'),
    url = process.argv[process.argv.length - 1];

if (!url) {
    console.log("send a url as the first argument!");
    return;
}

var req;
req = http.get(url, function(res) {
    var count = 0;
    MP3Frame.getFramesAsync(res, -1, 4).progress(function(frame) {
        console.log("found frame at " + frame.offset + " bitrate=" + frame.bitRate);
        if (count++ >= 10) {
            req.abort();
        }
    }).fail(function() {
        console.error("failed to load frames!!!");
    });
});

