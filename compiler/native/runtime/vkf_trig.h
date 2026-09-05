#ifndef VKF_TRIG_PUBLIC_TO_COMPILER_H
#define VKF_TRIG_PUBLIC_TO_COMPILER_H

/* Private compiler/runtime linkage; not a VKF host API. The implementation is
 * the same versioned C source packaged into direct native and WASM programs. */
#ifdef __cplusplus
extern "C" {
#endif
double vkf_trig_v1_sin(double);
double vkf_trig_v1_cos(double);
#ifdef __cplusplus
}
#endif
#endif
