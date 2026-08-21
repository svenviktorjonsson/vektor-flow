import numpy as np


values = np.arange(1.0, {{COUNT}} + 1.0, dtype=np.float64)
total = float(np.sum(values))
print(format(total + float(np.mean(values)) + float(values.size), '.17g'))
