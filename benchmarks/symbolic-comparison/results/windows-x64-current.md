# VKF symbolic comparison evidence

Compiler: `VKF 0.2.1`  
Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 3 per kernel/language; timeout: 30000 ms

| Kernel | VKF mean ± std | VKF / symengine | VKF / sympy | VKF / symbolics | <2× each |
| --- | ---: | ---: | ---: | ---: | --- |
| expand1 | 6.455 ± 1.355 ms | 0.092× | 6.02e-4× | <2.15e-4× | PASS |
| expand2 | 68.722 ± 8.903 ms | 0.113× | <0.002× | 0.015× | PASS |
| add1 | 0.294 ± 0.028 ms | 0.001× | 0.009× | 3.22e-4× | PASS |
| series | 1.990 ± 0.261 ms | 0.010× | 0.025× | 0.001× | PASS |

Ratios are VKF operation time divided by competitor operation time on this host.
A `<` ratio uses the competitor timeout as a conservative lower bound; no timeout is presented as a measured mean.
Ratios below 0.001 use scientific notation so a nonzero measurement is never displayed as zero.
