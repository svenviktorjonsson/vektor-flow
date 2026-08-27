# VKF symbolic comparison evidence

Compiler: `VKF 0.2.1`  
Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 3 per kernel/language; timeout: 30000 ms

| Kernel | VKF mean ± std | VKF / symengine | VKF / sympy | VKF / symbolics | <2× each |
| --- | ---: | ---: | ---: | ---: | --- |
| expand1 | 8.812 ± 4.058 ms | 0.109× | 4.52e-4× | <2.94e-4× | PASS |
| expand2 | 73.323 ± 8.959 ms | 0.112× | <0.002× | <0.002× | PASS |
| add1 | 0.489 ± 0.076 ms | 0.002× | 0.013× | <1.63e-5× | PASS |
| series | 4.790 ± 4.633 ms | 0.017× | 0.055× | <1.60e-4× | PASS |

Ratios are VKF operation time divided by competitor operation time on this host.
A `<` ratio uses the competitor timeout as a conservative lower bound; no timeout is presented as a measured mean.
Ratios below 0.001 use scientific notation so a nonzero measurement is never displayed as zero.
