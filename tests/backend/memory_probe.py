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
from test_backend import fixture

started = time.monotonic()
seconds = int(sys.argv[1]) if len(sys.argv)>1 else 45
with tempfile.TemporaryDirectory() as directory:
    work = Path(directory)
    fixture(work/'clip.wav',seconds)
    result = main.build_analysis(work/'clip.wav',work)
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024
    print(json.dumps({'synthetic_seconds':seconds,'process_peak_mib':round(peak,2),
        'under_150_mb':peak*1024*1024<=150000000,'dzh_bytes':result['size_bytes'],
        'torch_imported':'torch' in sys.modules,'elapsed_seconds':round(time.monotonic()-started,2)}))
