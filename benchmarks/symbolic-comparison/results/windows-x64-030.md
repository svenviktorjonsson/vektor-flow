# VKF symbolic comparison evidence

Compiler: `VKF 0.3.0`
Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64
Samples: 3 per kernel/language; timeout: 30000 ms

| Kernel | VKF mean ± std | VKF / symengine | VKF / sympy | VKF / symbolics | <2× each |
| --- | ---: | ---: | ---: | ---: | --- |
| expand1 | 8.406 ± 1.929 ms | 0.065× | 6.81e-4× | <2.80e-4× | PASS |
| expand2 | 72.198 ± 14.643 ms | 0.095× | <0.002× | 0.013× | PASS |
| add1 | 0.348 ± 0.106 ms | 0.002× | 0.008× | 3.11e-4× | PASS |
| series | 3.276 ± 2.377 ms | 0.014× | 0.037× | 0.002× | PASS |

Ratios are VKF operation time divided by competitor operation time on this host.
A `<` ratio uses the competitor timeout as a conservative lower bound; no timeout is presented as a measured mean.
Ratios below 0.001 use scientific notation so a nonzero measurement is never displayed as zero.
