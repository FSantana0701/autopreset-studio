"""Bounded float32 STFT, HPSS and Slaney-MFCC; no librosa/Numba runtime imports."""
from functools import lru_cache
import numpy as np

SAMPLE_RATE = 16000
MAX_BUFFER_SECONDS = 30
BLOCK_SECONDS = 2  # Strictly below the maximum; preserve the entire selected clip.
N_FFT = 1024
HOP = 256
WINDOW = np.hanning(N_FFT+1)[:-1].astype(np.float32)
FREQUENCIES = np.fft.rfftfreq(N_FFT,1/SAMPLE_RATE).astype(np.float32)


def stft(y):
    if y.ndim != 1 or not 0 < len(y) <= SAMPLE_RATE*MAX_BUFFER_SECONDS:
        raise ValueError("Buffer mono deve conter até 30 segundos a 16 kHz.")
    padded = np.pad(y,(N_FFT//2,N_FFT//2))
    frames = np.lib.stride_tricks.sliding_window_view(padded,N_FFT)[::HOP]
    return np.fft.rfft(frames*WINDOW,axis=1).astype(np.complex64,copy=False).T


def istft(spectrum, length):
    frames = np.fft.irfft(spectrum.T,n=N_FFT,axis=1).astype(np.float32,copy=False)*WINDOW
    size = N_FFT+HOP*(len(frames)-1)
    result = np.zeros(size,dtype=np.float32)
    weight = np.zeros(size,dtype=np.float32)
    square = WINDOW*WINDOW
    for index, frame in enumerate(frames):
        start = index*HOP
        result[start:start+N_FFT] += frame
        weight[start:start+N_FFT] += square
    np.divide(result,weight,out=result,where=weight>1e-10)
    return result[N_FFT//2:N_FFT//2+length]


def moving_median(magnitude, axis):
    # Half-sample symmetric edges match ndimage's reflect mode. Process frequency
    # rows in small batches so median's partition scratch stays below 1 MiB.
    padding = [(0,0),(0,0)]
    padding[axis] = (8,8)
    padded = np.pad(magnitude,padding,mode='symmetric')
    windows = np.lib.stride_tricks.sliding_window_view(padded,17,axis=axis)
    result = np.empty_like(magnitude)
    for row in range(0,len(result),32):
        result[row:row+32] = np.median(windows[row:row+32],axis=-1)
    return result


def hpss(y):
    spectrum = stft(y)
    magnitude = np.abs(spectrum)
    harmonic = moving_median(magnitude,axis=1)
    percussive = moving_median(magnitude,axis=0)
    # Soft harmonic mask, power=2 and margin=2, matching the previous HPSS.
    harmonic **= 2
    percussive *= 2
    percussive **= 2
    denominator = harmonic+percussive
    np.divide(harmonic,denominator,out=harmonic,where=denominator>0)
    return istft(spectrum*harmonic,len(y))


@lru_cache(maxsize=1)
def mel_basis():
    # Slaney scale and area normalization, matching librosa's default mel bank.
    def hz_to_mel(hz):
        return hz/(200/3) if hz<1000 else 15+np.log(hz/1000)/(np.log(6.4)/27)
    def mel_to_hz(mel):
        return mel*(200/3) if mel<15 else 1000*np.exp((mel-15)*(np.log(6.4)/27))
    edges = np.array([mel_to_hz(m) for m in np.linspace(0,hz_to_mel(8000),34)])
    weights = np.zeros((32,len(FREQUENCIES)),dtype=np.float32)
    for index in range(32):
        lower = (FREQUENCIES-edges[index])/(edges[index+1]-edges[index])
        upper = (edges[index+2]-FREQUENCIES)/(edges[index+2]-edges[index+1])
        weights[index] = np.maximum(0,np.minimum(lower,upper))*2/(edges[index+2]-edges[index])
    return weights


@lru_cache(maxsize=1)
def dct_basis():
    # First 13 rows of the orthonormal DCT-II; no SciPy runtime import needed.
    coefficients = np.arange(13)[:,None]
    samples = np.arange(32)[None,:]+.5
    basis = np.cos(np.pi/32*coefficients*samples)*np.sqrt(2/32)
    basis[0] /= np.sqrt(2)
    return basis.astype(np.float32)


def mfcc(power):
    mel = mel_basis()@power
    np.maximum(mel,1e-10,out=mel)
    np.log10(mel,out=mel)
    mel *= 10
    np.maximum(mel,float(mel.max())-80,out=mel)
    return dct_basis()@mel
