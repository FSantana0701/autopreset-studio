const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const events = new EventTarget();
let stopped = 0, recorderStarts = 0, sourceReads = 0;
const audio = Object.assign(events, {
 duration: 600, currentTime: 10, seeking: false, playbackRate: 1,
 captureStream() { return { getAudioTracks: () => [{}], getTracks: () => [{stop(){stopped++;}}] }; },
 pause() {},
 play() { this.currentTime = 11; return Promise.resolve(); }
});
class Recorder {
 static isTypeSupported(type) { return type.startsWith('audio/webm'); }
 constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; }
 start() { recorderStarts++; this.state = 'recording'; }
 stop() { this.state = 'inactive'; this.ondataavailable({data:new Blob(['recorded'],{type:this.mimeType})}); this.onstop(); }
}
let decodedSize = 0, closed = 0;
class Decoder {
 async decodeAudioData(data) { decodedSize=data.byteLength; return {duration:1,length:100,sampleRate:100,numberOfChannels:1,getChannelData:()=>new Float32Array(100).fill(0.2)}; }
 async close() { closed++; }
}
const ctx=vm.createContext({Blob,DOMException,setInterval,clearInterval,setTimeout,clearTimeout,MediaRecorder:Recorder,AudioContext:Decoder});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../integrations/audio-heuristic-analyzer.js'),'utf8'),ctx);
const api=ctx.AutoPresetAudioHeuristics;
(async()=>{
 const blob=await api.recordRange({audio,startTime:10,endTime:11});
 const result=await api.analyzeRecording({blob});
 assert.equal(decodedSize,8,'decodes only recorded bytes');
 assert.equal(result.features.duration_seconds,1);
 assert.equal(closed,1);assert.equal(stopped,1);
 assert.throws(()=>api.recordRange({audio,startTime:0,endTime:46}),/45/);
 assert.throws(()=>api.recordRange({audio:{duration:600},startTime:0,endTime:1}),/suporta/);
 audio.currentTime=10;audio.play=()=>Promise.resolve();
 const controller=new AbortController();
 const recording=api.recordRange({audio,startTime:10,endTime:11,signal:controller.signal});
 controller.abort();await assert.rejects(recording,{name:'AbortError'});
 assert.equal(stopped,2,'cancellation releases capture tracks');
 audio.currentTime=10;
 const interrupted=api.recordRange({audio,startTime:10,endTime:11});
 audio.dispatchEvent(new Event('seeking'));await assert.rejects(interrupted,/interrompida/);
 assert.equal(stopped,3);
 console.log('Cortador: Blob limitado, decode do trecho, suporte, limites, cancelamento e seek verificados.');
})().catch(error=>{console.error(error);process.exitCode=1;});
