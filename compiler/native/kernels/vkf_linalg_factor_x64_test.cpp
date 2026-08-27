#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string_view>

#include "compiler/native/kernels/vkf_linalg_factor_x64_bytes.hpp"

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#else
extern "C" std::uint64_t vkf_solve_x64(
    double* matrix, double* values, double* working, double* result,
    std::uint64_t size, double tolerance
);
extern "C" std::uint64_t vkf_solve_96_x64(
    double* matrix, double* values, double* working, double* result,
    std::uint64_t size, double tolerance
);
extern "C" std::uint64_t vkf_cholesky_96_x64(
    double* matrix, double* lower, std::uint64_t size, double tolerance
);
#endif

#ifdef VKF_FACTOR_BENCHMARK
extern "C" std::uint64_t baseline_cholesky_96_x64(
    double* matrix, double* lower, std::uint64_t size, double tolerance
);
#endif

namespace {

constexpr std::size_t size = 96;
constexpr std::size_t matrix_width = size * size;

using Solve96 = std::uint64_t (*)(
    double*, double*, double*, double*, std::uint64_t, double);
using Cholesky96 = std::uint64_t (*)(double*, double*, std::uint64_t, double);

double& matrix_at(std::array<double, matrix_width>& values,
                  std::size_t row, std::size_t column) {
    return values[matrix_width - 1u - (row * size + column)];
}

double& vector_at(std::array<double, size>& values, std::size_t index) {
    return values[size - 1u - index];
}

bool solve_96_recovers_a_pivoted_system(Solve96 solve_96) {
    std::array<double, matrix_width> matrix{};
    std::array<double, matrix_width> working{};
    std::array<double, size> expected{};
    std::array<double, size> right{};
    std::array<double, size> result{};

    for (std::size_t row = 0; row < size; ++row) {
        vector_at(expected, row) = static_cast<double>((row % 11u) + 1u) / 7.0;
        for (std::size_t column = 0; column < size; ++column) {
            matrix_at(matrix, row, column) = row == column
                ? 8.0 + static_cast<double>(row % 5u)
                : static_cast<double>(
                    static_cast<int>((row * 17u + column * 13u) % 9u) - 4) / 200.0;
        }
    }
    for (std::size_t column = 0; column < size; ++column) {
        std::swap(matrix_at(matrix, 0u, column), matrix_at(matrix, size - 1u, column));
    }
    for (std::size_t row = 0; row < size; ++row) {
        double total = 0.0;
        for (std::size_t column = 0; column < size; ++column) {
            total += matrix_at(matrix, row, column) * vector_at(expected, column);
        }
        vector_at(right, row) = total;
    }

    const auto ok = solve_96(
        matrix.data() + matrix_width - 1u,
        right.data() + size - 1u,
        working.data() + matrix_width - 1u,
        result.data() + size - 1u,
        size,
        1e-12);
    if (ok != 1u) return false;
    for (std::size_t index = 0; index < size; ++index) {
        if (std::abs(vector_at(result, index) - vector_at(expected, index)) > 1e-9) {
            return false;
        }
    }
    return true;
}

bool solve_96_rejects_a_singular_matrix(Solve96 solve_96) {
    std::array<double, matrix_width> matrix{};
    std::array<double, matrix_width> working{};
    std::array<double, size> right{};
    std::array<double, size> result{};
    return solve_96(
        matrix.data() + matrix_width - 1u,
        right.data() + size - 1u,
        working.data() + matrix_width - 1u,
        result.data() + size - 1u,
        size,
        1e-12) == 0u;
}

bool cholesky_96_reconstructs_a_dense_spd_matrix(Cholesky96 cholesky_96) {
    std::array<double, matrix_width> matrix{};
    std::array<double, matrix_width> lower{};
    for (std::size_t row = 0; row < size; ++row) {
        for (std::size_t column = 0; column < size; ++column) {
            matrix_at(matrix, row, column) =
                static_cast<double>(std::min(row, column) + 1u);
        }
    }

    const auto ok = cholesky_96(
        matrix.data() + matrix_width - 1u,
        lower.data() + matrix_width - 1u,
        size,
        1e-12);
    if (ok != 1u) return false;
    for (std::size_t row = 0; row < size; ++row) {
        for (std::size_t column = 0; column < size; ++column) {
            const double expected = column <= row ? 1.0 : 0.0;
            if (std::abs(matrix_at(lower, row, column) - expected) > 1e-9) {
                return false;
            }
        }
    }
    return true;
}

bool cholesky_96_rejects_a_non_positive_matrix(Cholesky96 cholesky_96) {
    std::array<double, matrix_width> matrix{};
    std::array<double, matrix_width> lower{};
    return cholesky_96(
        matrix.data() + matrix_width - 1u,
        lower.data() + matrix_width - 1u,
        size,
        1e-12) == 0u;
}

#ifdef VKF_FACTOR_BENCHMARK
double timed_cholesky(Cholesky96 function) {
    std::array<double, matrix_width> matrix{};
    std::array<double, matrix_width> lower{};
    std::array<double, matrix_width> fixture{};
    std::ifstream input(
        "benchmarks/linalg-comparison/fixtures/spd-96.f64le",
        std::ios::binary);
    input.read(
        reinterpret_cast<char*>(fixture.data()),
        static_cast<std::streamsize>(sizeof(fixture)));
    if (!input) return -1.0;
    for (std::size_t row = 0; row < size; ++row) {
        for (std::size_t column = 0; column < size; ++column) {
            matrix_at(matrix, row, column) = fixture[row * size + column];
        }
    }
    const auto started = std::chrono::steady_clock::now();
    const auto ok = function(
        matrix.data() + matrix_width - 1u,
        lower.data() + matrix_width - 1u,
        size,
        1e-12);
    const auto stopped = std::chrono::steady_clock::now();
    if (ok != 1u) return -1.0;
    return std::chrono::duration<double, std::milli>(stopped - started).count();
}

double timed_solve(Solve96 function) {
    std::array<double, matrix_width> matrix{};
    std::array<double, matrix_width> working{};
    std::array<double, size> right{};
    std::array<double, size> result{};
    std::array<double, matrix_width + size * 2u> fixture{};
    std::ifstream input(
        "benchmarks/linalg-comparison/fixtures/general-96.f64le",
        std::ios::binary);
    input.read(
        reinterpret_cast<char*>(fixture.data()),
        static_cast<std::streamsize>(sizeof(fixture)));
    if (!input) return -1.0;
    for (std::size_t row = 0; row < size; ++row) {
        for (std::size_t column = 0; column < size; ++column) {
            matrix_at(matrix, row, column) = fixture[row * size + column];
        }
        vector_at(right, row) = fixture[matrix_width + size + row];
    }
    const auto started = std::chrono::steady_clock::now();
    const auto ok = function(
        matrix.data() + matrix_width - 1u,
        right.data() + size - 1u,
        working.data() + matrix_width - 1u,
        result.data() + size - 1u,
        size,
        1e-12);
    const auto stopped = std::chrono::steady_clock::now();
    if (ok != 1u) return -1.0;
    return std::chrono::duration<double, std::milli>(stopped - started).count();
}
#endif

}  // namespace

int main(int argc, char** argv) {
#ifdef _WIN32
    using namespace vkf::native_kernels;
    auto* code = static_cast<unsigned char*>(VirtualAlloc(
        nullptr, linalg_factor_x64_windows.size(),
        MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE));
    if (!code) return 2;
    std::memcpy(
        code, linalg_factor_x64_windows.data(),
        linalg_factor_x64_windows.size());
    DWORD previous = 0;
    if (!VirtualProtect(
            code, linalg_factor_x64_windows.size(), PAGE_EXECUTE_READ,
            &previous)) {
        VirtualFree(code, 0, MEM_RELEASE);
        return 2;
    }
    FlushInstructionCache(
        GetCurrentProcess(), code, linalg_factor_x64_windows.size());
    const auto solve_96 = reinterpret_cast<Solve96>(
        code + linalg_factor_solve_96_entry);
    const auto solve_generic = reinterpret_cast<Solve96>(
        code + linalg_factor_solve_entry);
    const auto cholesky_96 = reinterpret_cast<Cholesky96>(
        code + linalg_factor_cholesky_96_entry);
#else
    const auto solve_96 = &vkf_solve_96_x64;
    const auto solve_generic = &vkf_solve_x64;
    const auto cholesky_96 = &vkf_cholesky_96_x64;
#endif
    if (!solve_96_recovers_a_pivoted_system(solve_96)) {
        std::cerr << "solve_96_recovers_a_pivoted_system failed\n";
        return 1;
    }
    if (!solve_96_recovers_a_pivoted_system(solve_generic)) {
        std::cerr << "solve_generic_recovers_a_pivoted_system failed\n";
        return 1;
    }
    if (!solve_96_rejects_a_singular_matrix(solve_96)) {
        std::cerr << "solve_96_rejects_a_singular_matrix failed\n";
        return 1;
    }
    if (!cholesky_96_reconstructs_a_dense_spd_matrix(cholesky_96)) {
        std::cerr << "cholesky_96_reconstructs_a_dense_spd_matrix failed\n";
        return 1;
    }
    if (!cholesky_96_rejects_a_non_positive_matrix(cholesky_96)) {
        std::cerr << "cholesky_96_rejects_a_non_positive_matrix failed\n";
        return 1;
    }
#ifdef VKF_FACTOR_BENCHMARK
    if (argc == 2 && std::string_view(argv[1]) == "--benchmark") {
        static_cast<void>(timed_cholesky(cholesky_96));
        static_cast<void>(timed_cholesky(&baseline_cholesky_96_x64));
        static_cast<void>(timed_solve(solve_96));
        for (unsigned sample = 0; sample < 10u; ++sample) {
            double baseline = 0.0;
            double candidate = 0.0;
            if ((sample & 1u) == 0u) {
                baseline = timed_cholesky(&baseline_cholesky_96_x64);
                candidate = timed_cholesky(cholesky_96);
            } else {
                candidate = timed_cholesky(cholesky_96);
                baseline = timed_cholesky(&baseline_cholesky_96_x64);
            }
            std::cout << "sample=" << sample
                      << " cholesky_baseline_ms=" << baseline
                      << " cholesky_candidate_ms=" << candidate
                      << " solve_candidate_ms=" << timed_solve(solve_96)
                      << '\n';
        }
    }
#else
    static_cast<void>(argc);
    static_cast<void>(argv);
#endif
#ifdef _WIN32
    VirtualFree(code, 0, MEM_RELEASE);
#endif
    return 0;
}
