import numpy as np
from scipy.signal import lfilter


count = {{COUNT}}
forcing = np.arange(count, dtype=np.float64) * 0.0000001
result, _ = lfilter(
    np.array([1.0]),
    np.array([1.0, -0.9999997]),
    forcing,
    zi=np.array([0.9999997]),
)
print(format(float(result[-1]), '.17g'))
