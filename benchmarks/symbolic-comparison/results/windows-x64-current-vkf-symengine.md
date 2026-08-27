# VKF symbolic comparison evidence

Compiler: `VKF 0.2.1`  
Host: `Intel(R) Core(TM) Ultra 7 255U`, win32-x64  
Samples: 3 per kernel/language; timeout: 30000 ms

| Kernel | VKF mean ± std | VKF / symengine | <2× each |
| --- | ---: | ---: | --- |
| expand1 | 5.141 ± 0.090 ms | 0.075× | PASS |
| expand2 | 65.274 ± 2.987 ms | 0.111× | PASS |
| add1 | 0.255 ± 0.019 ms | 0.001× | PASS |
| series | 2.959 ± 1.563 ms | 0.014× | PASS |

Ratios are VKF operation time divided by competitor operation time on this host.
A `<` ratio uses the competitor timeout as a conservative lower bound; no timeout is presented as a measured mean.
Ratios below 0.001 use scientific notation so a nonzero measurement is never displayed as zero.
