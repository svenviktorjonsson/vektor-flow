#include <stdio.h>

static int validated_integer(double value) {
    const long long converted = (long long) value;
    return (double) converted == value;
}

static unsigned long long count_valid_integers(
    const volatile double *data,
    int length
) {
    unsigned long long accepted = 0;
    for (int index = 0; index < length; ++index) {
        accepted += (unsigned long long) validated_integer(data[index]);
    }
    return accepted;
}

int main(void) {
    volatile double values[] = { {{VALIDATION_VALUES}} };
    printf("%llu\n", count_valid_integers(values, {{COUNT}}));
    return 0;
}
