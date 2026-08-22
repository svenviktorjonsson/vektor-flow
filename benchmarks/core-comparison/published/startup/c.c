#include <stdio.h>
#ifdef _WIN32
__declspec(dllexport)
#else
__attribute__((visibility("default")))
#endif
double vkf_benchmark(void) { return 0.0; }

int main(void) {
    printf("0\n");
    return 0;
}
