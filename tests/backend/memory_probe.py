"""Run from repository root: python tests/backend/memory_probe.py [seconds].
Synthetic diagnostic, no external audio/download. Includes FastAPI + DSP imports.
"""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import main
import json
import resource
import tempfile
import time
import uvicorn  # Account for the production server imports as well.


def fixture(path, seconds):
    import numpy as np
    import soundfile as sf
    # Generate diagnostics in 2 s chunks, without allocating a full-length track.
    with sf.SoundFile(path,'w',samplerate=16000,channels=1,subtype='PCM_16') as output:
        for start in range(0,seconds*16000,32000):
            samples = np.arange(start,min(start+32000,seconds*16000),dtype='float32')
            y = .3*np.sin(samples*(2*np.pi*220/16000))
            y[(samples.astype('int64')%4000)==0] += .5
            output.write(y)


started = time.monotonic()
seconds = int(sys.argv[1]) if len(sys.argv)>1 else 45
with tempfile.TemporaryDirectory() as directory:
    work = Path(directory)
    fixture(work/'clip.wav',seconds)
    result = main.build_analysis(work/'clip.wav',work)
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
    # Linux ru_maxrss can retain the pytest parent's peak across fork/exec.
    # VmHWM measures this executable, excluding SDK imports in the test runner.
    status = Path('/proc/self/status')
    if status.exists():
        peak = next(float(line.split()[1])/1024 for line in status.read_text().splitlines()
                    if line.startswith('VmHWM:'))
    print(json.dumps({'synthetic_seconds':seconds,'process_peak_mib':round(peak,2),
        'under_100_mb':peak*1024*1024<=100000000,
        'librosa_imported':'librosa' in sys.modules, 'numba_imported':'numba' in sys.modules,'dzh_bytes':result['size_bytes'],
        'torch_imported':'torch' in sys.modules,'elapsed_seconds':round(time.monotonic()-started,2)}))
