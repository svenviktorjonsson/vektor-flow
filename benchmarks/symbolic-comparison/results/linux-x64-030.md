# VKF symbolic comparison evidence

Compiler: `VKF 0.3.0`
Host: `INTEL(R) XEON(R) PLATINUM 8573C`, linux-x64
Samples: 10 per kernel/language; timeout: 30000 ms

| Kernel | VKF mean ± std | VKF / symengine | VKF / sympy | VKF / symbolics | <1.5× each |
| --- | ---: | ---: | ---: | ---: | --- |
| expand1 | 6.070 ± 0.187 ms | 0.115× | 6.15e-4× | <2.02e-4× | PASS |
| expand2 | 65.273 ± 1.097 ms | 0.233× | <0.002× | 0.019× | PASS |
| add1 | 0.271 ± 0.019 ms | 0.002× | 0.009× | 4.08e-4× | PASS |
| series | 2.295 ± 0.104 ms | 0.022× | 0.027× | 0.002× | PASS |

Ratios are VKF operation time divided by competitor operation time on this host.
A `<` ratio uses the competitor timeout as a conservative lower bound; no timeout is presented as a measured mean.
Ratios below 0.001 use scientific notation so a nonzero measurement is never displayed as zero.
