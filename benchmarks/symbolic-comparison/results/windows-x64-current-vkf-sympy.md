# VKF symbolic comparison evidence

Compiler: `VKF 0.2.1`  
Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 3 per kernel/language; timeout: 30000 ms

| Kernel | VKF mean ± std | VKF / sympy | <2× each |
| --- | ---: | ---: | --- |
| expand1 | 6.121 ± 0.578 ms | 4.40e-4× | PASS |
| expand2 | 83.693 ± 2.361 ms | <0.003× | PASS |
| add1 | 0.396 ± 0.064 ms | 0.010× | PASS |
| series | 2.599 ± 0.140 ms | 0.027× | PASS |

Ratios are VKF operation time divided by competitor operation time on this host.
A `<` ratio uses the competitor timeout as a conservative lower bound; no timeout is presented as a measured mean.
Ratios below 0.001 use scientific notation so a nonzero measurement is never displayed as zero.
