#ifndef VKF_TRIG_INTERNAL_H
#define VKF_TRIG_INTERNAL_H
/* Private binary64-only shim for the licensed musl candidate. No host libm calls.
 * Compile with nearest binary64 evaluation, no fast math and FP contraction off.
 * Candidate only: no production runtime selects this source yet.
 */
#include <stdint.h>
#include <float.h>
#include <math.h>
#if FLT_EVAL_METHOD != 0
#error VKF deterministic trigonometry requires binary64 evaluation
#endif
#define sin vkf_trig_v1_sin
#define cos vkf_trig_v1_cos
#define __sin vkf_trig_v1_kernel_sin
#define __cos vkf_trig_v1_kernel_cos
#define __rem_pio2 vkf_trig_v1_rem_pio2
#define __rem_pio2_large vkf_trig_v1_rem_pio2_large
#define scalbn vkf_trig_v1_scalbn
#define floor vkf_trig_v1_floor
#define predict_false(x) (x)
#define GET_HIGH_WORD(hi,d) do { union { double value; uint64_t bits; } word = {(d)}; (hi) = word.bits >> 32; } while(0)
#define FORCE_EVAL(x) do { volatile double value = (x); (void)value; } while(0)
double sin(double);
double cos(double);
double __sin(double,double,int);
double __cos(double,double);
int __rem_pio2(double,double*);
int __rem_pio2_large(double*,double*,int,int,int);
double scalbn(double,int);
double floor(double);
#endif
