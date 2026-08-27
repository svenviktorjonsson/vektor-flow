# VKF symbolic comparison evidence

Compiler: `VKF 0.2.1`  
Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 3 per kernel/language; timeout: 30000 ms

| Kernel | VKF mean ± std | VKF / symbolics | <2× each |
| --- | ---: | ---: | --- |
| expand1 | 7.641 ± 2.688 ms | <2.55e-4× | PASS |
| expand2 | 67.576 ± 8.155 ms | 0.014× | PASS |
| add1 | 0.406 ± 0.115 ms | 4.06e-4× | PASS |
| series | 2.556 ± 0.703 ms | 0.001× | PASS |

Ratios are VKF operation time divided by competitor operation time on this host.
A `<` ratio uses the competitor timeout as a conservative lower bound; no timeout is presented as a measured mean.
Ratios below 0.001 use scientific notation so a nonzero measurement is never displayed as zero.
