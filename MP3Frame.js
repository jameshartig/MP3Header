(function(window) {

    var bitRates = [
        [0,0,0,0,0],
        [32,32,32,32,8],
        [64,48,40,48,16],
        [96,56,48,56,24],
        [128,64,56,64,32],
        [160,80,64,80,40],
        [192,96,80,96,48],
        [224,112,96,112,56],
        [256,128,112,128,64],
        [288,160,128,144,80],
        [320,192,160,160,96],
        [352,224,192,176,112],
        [384,256,224,192,128],
        [416,320,256,224,144],
        [448,384,320,256,160]
    ];
    var sampleRates = [
        [11025,12000,8000], //mpeg 2.5
        [0,0,0], //reserved
        [22050,24000,16000], //mpeg 2
        [44100,48000,32000] //mpeg 1
    ];

    function getFrames(fileBytes, limitFrames, offset) {
        var bytesLength = fileBytes.length,
            frames = [],
            frameCount = 0,
            totalBitRate = 0,
            lastFrameLength = 0,
            lastFrameVerify = null,
            brRow, srIndex, slotsPerFrame, frameData;

        if (limitFrames < 0) {
            limitFrames = Infinity;
        }

        for (var o = Math.floor(offset || 0); o < bytesLength && frameCount < limitFrames; o++) {

            if ((fileBytes.charCodeAt(o) & 0xFF) == 255 && (fileBytes.charCodeAt(o+1) & 0xE0) == 224) {

                //verify the header first
                frameData = {};
                frameData.offset = o;
                //header is AAAAAAAA AAABBCCD EEEEFFGH IIJJKLMM
                frameData.version = (fileBytes.charCodeAt(o+1) & 24) >> 3; //get BB (0 -> 3)
                frameData.layer = Math.abs(((fileBytes.charCodeAt(o+1) & 6) >> 1) - 4); //get CC (1 -> 3), then invert
                srIndex = (fileBytes.charCodeAt(o+2) & 12) >> 2; //get FF (0 -> 3)
                brRow = (fileBytes.charCodeAt(o+2) & 240) >> 4; //get EEEE (0 -> 15)
                frameData.padding = (fileBytes.charCodeAt(o+2) & 2) >> 1; //get G
                frameData.verify = (fileBytes.charCodeAt(o+1) & 31) << 2 + srIndex; // ABBCCD and combined with FF: ABBCCDFF

                if (frameData.version !== 1 && frameData.layer > 0 && srIndex < 3 && brRow != 15 && brRow != 0 &&
                    (lastFrameVerify === null || lastFrameVerify === frameData.verify)) {
                    //frame header is valid
                    frameData.sampleRate = sampleRates[frameData.version][srIndex];
                    if ((frameData.version & 1) === 1) {
                        frameData.bitRate = bitRates[brRow][frameData.layer-1]; //v1 and l1,l2,l3
                    } else { //LSF
                        frameData.bitRate = bitRates[brRow][(frameData.layer & 2 >> 1)+3]; //v2 and l1 or l2/l3
                    }

                    if (frameData.layer === 1) {
                        frameData.frameLength = (12 * frameData.bitRate * 1000 / frameData.sampleRate + frameData.padding) * 4;
                    } else {
                        //if frame is LSF then slots are only 72 instead of 144
                        slotsPerFrame = (frameData.layer === 3 && (frameData.version & ~1) === frameData.version) ? 72 : 144;
                        frameData.frameLength = (slotsPerFrame * frameData.bitRate * 1000 / frameData.sampleRate) + frameData.padding;
                    }

                    //frame header is valid
                    totalBitRate += frameData.bitRate;
                    frames.push(frameData);
                    frameCount++;
                    lastFrameVerify = frameData.verify;
                    lastFrameLength = Math.floor(frameData.frameLength);
                    o += lastFrameLength - 1; //substract one because next loop will add one
                } else {
                    frames = [];
                    frameCount = 0;
                    totalBitRate = 0;
                    lastFrameVerify = null;
                    if (lastFrameLength > 0) {
                        o -= lastFrameLength; //don't subtract one otherwise we'll go back to the same spot we were at last time we looped
                        lastFrameLength = 0; //only backtrack once
                    }
                }
            }
        }
        return frames;
    }

    var TinyDeferredCallbacks = ['_p', '_d', '_f'];
    function TinyDeferred() {
        this[TinyDeferredCallbacks[0]] = null; //progress
        this[TinyDeferredCallbacks[1]] = null; //done
        this[TinyDeferredCallbacks[2]] = null; //fail
        this._state = 0;
        this.result = undefined;
    }
    var TinyDeferredProcessResult = function(_this, newState, args) {
        //if we're not still pending ignore this
        if (_this._state > 0) {
            return;
        }
        _this._state = newState;
        _this.result = args;
        var callbacksName = TinyDeferredCallbacks[newState];
        if (_this[callbacksName] === null) {
            return;
        }
        //can't cache length because something might be adding more callbacks inside of a callback >_<
        for (var i = 0; i < _this[callbacksName].length; i++) {
            if (typeof _this[callbacksName][i] === 'function') {
                _this[callbacksName][i].apply(_this, args);
            }
        }
        if (newState > 0) {
            //remove all callbacks
            for (i = 0; i <= 2; i++) {
                _this[TinyDeferredCallbacks[i]] = null;
            }
        }
    };
    var TinyDeferredStoreCallback = function(_this, state, func) {
        //if we're not pending and the state matches call immediately, otherwise bail
        if (_this._state > 0) {
            if (_this._state === state) {
                func.apply(_this, _this.result);
            }
            return;
        }
        var callbacksName = TinyDeferredCallbacks[state];
        if (_this[callbacksName] === null) {
            _this[callbacksName] = [func];
        } else {
            _this[callbacksName].push(func);
        }
    };
    TinyDeferred.prototype.promise = function() {
        return this;
    };
    TinyDeferred.prototype.notify = function() {
        TinyDeferredProcessResult(this, 0, Array.prototype.slice.call(arguments, 0));
        return this;
    };
    TinyDeferred.prototype.resolve = function() {
        TinyDeferredProcessResult(this, 1, Array.prototype.slice.call(arguments, 0));
        return this;
    };
    TinyDeferred.prototype.reject = function() {
        TinyDeferredProcessResult(this, 2, Array.prototype.slice.call(arguments, 0));
        return this;
    };
    TinyDeferred.prototype.progress = function() {
        for (var i = 0, l = arguments.length; i < l; i++) {
            TinyDeferredStoreCallback(this, 0, arguments[0]);
        }
        return this;
    };
    TinyDeferred.prototype.done = TinyDeferred.prototype.then = function() {
        for (var i = 0, l = arguments.length; i < l; i++) {
            TinyDeferredStoreCallback(this, 1, arguments[0]);
        }
        return this;
    };
    TinyDeferred.prototype.fail = function() {
        for (var i = 0, l = arguments.length; i < l; i++) {
            TinyDeferredStoreCallback(this, 2, arguments[0]);
        }
        return this;
    };

    if (typeof require === 'function') {
        var http = require('http'),
            stream = require('stream');
    }
    var MP3Frame = {
        getFrames: function(src, limit) {
            if (typeof Buffer !== 'undefined' && src instanceof Buffer) {
                //convert to string, this kinda sucks though
                //todo: instead make a StringBuffer class that has a charCodeAt method (String.fromCharCode(this.getByteAt(iOffset));)
            }
        },
        getFramesAsync: function(src, limitFrames, chunkSize) {
            if (limitFrames < 0) {
                limitFrames = Infinity;
            }
            chunkSize = Math.min(limitFrames, chunkSize || 1);
            var dfd = new TinyDeferred(),
                count = 0,
                offset = 0; //used for strings and XMLHttpRequest's responseText and for keeping relative track in the buffers
            //todo: support http request
            if (typeof stream !== 'undefined' && typeof stream.Readable !== 'undefined' && src instanceof stream.Readable) {
                var buf,
                    dropHeaders = true;
                function onMP3Data(chunk) {
                    //attempt to strip off the http headers
                    if (dropHeaders) {
                        if ((chunk instanceof Buffer)) {
                            if (chunk.toString('utf8', 0, 4) === "HTTP") {
                                for (var hOff = 0, len = chunk.length; hOff < len; hOff++) {
                                    //10 = \n
                                    //13 = \r
                                    if (chunk[hOff] === 13 && chunk[hOff + 1] === 10 && chunk[hOff + 2] === 13 && chunk[hOff + 3] === 10) {
                                        var newChunk = new Buffer(chunk.length - (hOff + 4));
                                        chunk.copy(newChunk, 0, hOff + 4);
                                        chunk = newChunk;
                                        break;
                                    }
                                }
                            }
                        } else if (chunk.slice(0, 4) === "HTTP") {
                            var headerEndIndex = chunk.indexOf("\r\n\r\n");
                            if (headerEndIndex > -1) {
                                chunk = chunk.slice(headerEndIndex + 4);
                            }
                        }
                        //this isn't perfect since we *might* get a header longer than 1 packet...
                        dropHeaders = false;
                    }
                    if (buf == null) {
                        if (chunk instanceof Buffer) {
                            buf = chunk;
                            buf = Buffer.concat([buf, chunk]);
                        } else {
                            buf = new Buffer(chunk);
                        }
                    } else {
                        if (chunk instanceof Buffer) {
                            buf = Buffer.concat([buf, chunk]);
                        } else {
                            var combinedBuffer;
                            combinedBuffer = new Buffer(buf.length + chunk.length);
                            if (buf) {
                                buf.copy(combinedBuffer);
                            }
                            combinedBuffer.write(chunk);
                            buf = combinedBuffer;
                        }
                    }
                    //convert to string, this kinda sucks though
                    //todo: instead make a StringBuffer class that has a charCodeAt method (String.fromCharCode(this.getByteAt(iOffset));)
                    var frames = getFrames(buf.toString('binary'), chunkSize);
                    if (frames.length < chunkSize) {
                        return;
                    }
                    for (var i = 0, lastFrame; lastFrame = frames[i]; i++) {
                        lastFrame.offset += offset; //keep the offset relative to the beginning of the stream
                        dfd.notify(lastFrame);
                        count++;
                        if (count >= limitFrames) {
                            //todo: support http request
                            if (typeof src.abort === 'function') {
                                src.abort();
                            }
                            return;
                        }
                    }
                    offset += buf.length;
                    buf = null;
                }

                //might as well turn into flowing mode since we have to keep our own buffer anyways...
                src.on('data', onMP3Data);
                if (src instanceof http.ClientRequest) {
                    /*src.on('response', function onMP3End() {
                        if (count > 0) {
                            //todo: pass all frames
                            dfd.resolve();
                        } else {
                            dfd.fail();
                        }
                        src.removeListener('data', onMP3Data);
                        src.removeListener('response', onMP3End);
                    });*/
                    //todo: wtf do we do here?
                } else {
                    src.on('end', function onMP3End() {
                        if (count > 0) {
                            //todo: pass all frames
                            dfd.resolve();
                        } else {
                            dfd.fail();
                        }
                        src.removeListener('data', onMP3Data);
                        src.removeListener('end', onMP3End);
                    });
                }
            } else if (typeof XMLHttpRequest !== 'undefined' && src instanceof XMLHttpRequest) {
                if (!(typeof src.overrideMimeType !== 'function')) {
                    //incompatible browser
                    return dfd.reject().promise();
                }
                src.overrideMimeType("text/plain; charset=x-user-defined");
                //todo: use responseType = "arraybuffer" or even "moz-chunked-arraybuffer"
                //todo: somehow detect if we support progress events
                function onProgress() {
                    //todo: estimate if we have enough data
                    var frames = getFrames(this.responseText, chunkSize, offset);
                    if (frames.length < chunkSize) {
                        //todo: we should rollback the offset and probably return something about losing a frame sync
                        return;
                    }
                    for (var i = 0, lastFrame; lastFrame = frames[i]; i++) {
                        dfd.notify(lastFrame);
                        count++;
                        if (count >= limitFrames) {
                            src.abort();
                            return;
                        }
                    }
                    offset = lastFrame.offset + Math.floor(lastFrame.frameLength);
                }
                src.addEventListener('progress', onProgress);
                src.addEventListener('load', function onLoad() {
                    if (count > 0) {
                        //todo: pass all frames
                        dfd.resolve();
                    } else {
                        dfd.fail();
                    }
                    src.removeEventListener('progress', onProgress);
                    src.removeEventListener('load', onLoad);
                });
            } else {
                var len = src.length;
                while (offset < len) {
                    var frames = getFrames(src, chunkSize, offset);
                    if (frames.length < chunkSize) {
                        //todo: we should rollback the offset and probably return something about losing a frame sync
                        return;
                    }
                    for (var i = 0, lastFrame; lastFrame = frames[i]; i++) {
                        dfd.notify(lastFrame);
                        count++;
                        if (count >= limitFrames) {
                            break;
                        }
                    }
                    offset = lastFrame.offset + Math.floor(lastFrame.frameLength);
                }
                if (count > 0) {
                    //todo: pass all frames
                    dfd.resolve();
                } else {
                    dfd.fail();
                }
            }
            return dfd.promise();
        }
    };

    if (typeof module !== 'undefined') {
        module.exports = MP3Frame;
    } else {
        window.MP3Frame = MP3Frame;

        if (typeof define === 'function' && typeof define.amd === 'object' && define.amd) {
            define('MP3Frame', function() { return MP3Frame; });
        }
    }
}(this));