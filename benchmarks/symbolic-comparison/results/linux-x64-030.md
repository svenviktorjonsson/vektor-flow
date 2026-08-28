# VKF symbolic comparison evidence

Compiler: `VKF 0.3.0`
Host: `AMD EPYC 9V74 80-Core Processor`, linux-x64
Samples: 10 per kernel/language; timeout: 30000 ms

| Kernel | VKF mean ± std | VKF / symengine | VKF / sympy | VKF / symbolics | <1.5× each |
| --- | ---: | ---: | ---: | ---: | --- |
| expand1 | 7.987 ± 0.262 ms | 0.142× | 8.67e-4× | <2.66e-4× | PASS |
| expand2 | 81.279 ± 0.405 ms | 0.295× | <0.003× | 0.024× | PASS |
| add1 | 0.516 ± 0.012 ms | 0.004× | 0.017× | 7.50e-4× | PASS |
| series | 2.920 ± 0.057 ms | 0.028× | 0.030× | 0.002× | PASS |

Ratios are VKF operation time divided by competitor operation time on this host.
A `<` ratio uses the competitor timeout as a conservative lower bound; no timeout is presented as a measured mean.
Ratios below 0.001 use scientific notation so a nonzero measurement is never displayed as zero.
