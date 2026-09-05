// Same bit-preserving operation as native MachineX64Emitter::emit_number.
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>

int main(int argc, char** argv) {
    if (argc != 4) return 1;
    double value = std::ldexp(std::strtod(argv[1], nullptr), std::atoi(argv[2]));
    if (std::atoi(argv[3]) == 1) value = -value;
    std::uint64_t bits = 0;
    std::memcpy(&bits, &value, sizeof(bits));
    std::cout << '[';
    for (unsigned index = 0; index < 8; ++index) {
        if (index) std::cout << ',';
        std::cout << ((bits >> (index * 8)) & 255);
    }
    std::cout << "]\n";
}
