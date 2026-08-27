#include <cstddef>
#include <cstdint>
#include <emmintrin.h>

#ifdef _WIN32
extern "C" int _fltused = 0;
#endif

namespace {

inline double square_root(double value) {
    return _mm_cvtsd_f64(_mm_sqrt_sd(_mm_setzero_pd(), _mm_set_sd(value)));
}

inline double magnitude(double value) {
    return value < 0.0 ? -value : value;
}

}

// Compiler kernel ABI. Arrays use VKF's descending fixed-vector layout:
// element i is base[-i]. `workspace` provides 2*n temporary doubles.
extern "C" std::uint64_t vkf_symmetric_eigen_x64(
    double* matrix,
    double* vectors,
    double* workspace,
    std::uint64_t size,
    double tolerance,
    std::uint64_t max_iterations,
    std::uint64_t* completed_iterations
) {
    const auto at = [size](double* base, std::uint64_t row, std::uint64_t column)
        -> double& { return base[-static_cast<std::ptrdiff_t>(column * size + row)]; };
    const auto matrix_at = [size](double* base, std::uint64_t row,
                                  std::uint64_t column) -> double& {
        return base[-static_cast<std::ptrdiff_t>(row * size + column)];
    };
    const auto d = [workspace](std::uint64_t index) -> double& {
        return workspace[-static_cast<std::ptrdiff_t>(index)];
    };
    const auto e = [workspace, size](std::uint64_t index) -> double& {
        return workspace[-static_cast<std::ptrdiff_t>(size + index)];
    };

    for (std::uint64_t row = 0; row < size; ++row) {
        for (std::uint64_t column = 0; column < size; ++column) {
            at(vectors, row, column) = matrix_at(matrix, row, column);
        }
    }
    for (std::uint64_t column = 0; column < size; ++column) {
        d(column) = at(vectors, size - 1, column);
    }
    // Householder reduction to tridiagonal form (EISPACK TRED2/JAMA).
    for (std::uint64_t i = size - 1; i > 0; --i) {
        double scale = 0.0;
        double h = 0.0;
        for (std::uint64_t k = 0; k < i; ++k) scale += magnitude(d(k));
        if (scale == 0.0) {
            e(i) = d(i - 1);
            for (std::uint64_t j = 0; j < i; ++j) {
                d(j) = at(vectors, i - 1, j);
                at(vectors, i, j) = 0.0;
                at(vectors, j, i) = 0.0;
            }
        } else {
            for (std::uint64_t k = 0; k < i; ++k) {
                d(k) /= scale;
                h += d(k) * d(k);
            }
            double f = d(i - 1);
            double g = square_root(h);
            if (f > 0.0) g = -g;
            e(i) = scale * g;
            h -= f * g;
            d(i - 1) = f - g;
            for (std::uint64_t j = 0; j < i; ++j) e(j) = 0.0;
            for (std::uint64_t j = 0; j < i; ++j) {
                f = d(j);
                at(vectors, j, i) = f;
                g = e(j) + at(vectors, j, j) * f;
                for (std::uint64_t k = j + 1; k < i; ++k) {
                    g += at(vectors, k, j) * d(k);
                    e(k) += at(vectors, k, j) * f;
                }
                e(j) = g;
            }
            f = 0.0;
            for (std::uint64_t j = 0; j < i; ++j) {
                e(j) /= h;
                f += e(j) * d(j);
            }
            const double half_projection = f / (h + h);
            for (std::uint64_t j = 0; j < i; ++j) e(j) -= half_projection * d(j);
            for (std::uint64_t j = 0; j < i; ++j) {
                f = d(j);
                g = e(j);
                for (std::uint64_t k = j; k < i; ++k) {
                    at(vectors, k, j) -= f * e(k) + g * d(k);
                }
                d(j) = at(vectors, i - 1, j);
                at(vectors, i, j) = 0.0;
            }
        }
        d(i) = h;
    }

    // Accumulate transformations.
    for (std::uint64_t i = 0; i + 1 < size; ++i) {
        at(vectors, size - 1, i) = at(vectors, i, i);
        at(vectors, i, i) = 1.0;
        const double h = d(i + 1);
        if (h != 0.0) {
            for (std::uint64_t k = 0; k <= i; ++k) {
                d(k) = at(vectors, k, i + 1) / h;
            }
            for (std::uint64_t j = 0; j <= i; ++j) {
                double g = 0.0;
                for (std::uint64_t k = 0; k <= i; ++k) {
                    g += at(vectors, k, i + 1) * at(vectors, k, j);
                }
                for (std::uint64_t k = 0; k <= i; ++k) {
                    at(vectors, k, j) -= g * d(k);
                }
            }
        }
        for (std::uint64_t k = 0; k <= i; ++k) at(vectors, k, i + 1) = 0.0;
    }
    for (std::uint64_t j = 0; j < size; ++j) {
        d(j) = at(vectors, size - 1, j);
        at(vectors, size - 1, j) = 0.0;
    }
    at(vectors, size - 1, size - 1) = 1.0;
    e(0) = 0.0;
    // Implicit QL for the tridiagonal problem (EISPACK TQL2/JAMA).
    for (std::uint64_t i = 1; i < size; ++i) e(i - 1) = e(i);
    e(size - 1) = 0.0;
    double shift = 0.0;
    double test_scale = 0.0;
    std::uint64_t total_iterations = 0;
    std::uint64_t converged = 1;
    union { std::uint64_t bits; double value; } epsilon_bits{
        0x3cb0000000000000ull
    };
    const double epsilon = epsilon_bits.value;
    for (std::uint64_t l = 0; l < size; ++l) {
        const double candidate = magnitude(d(l)) + magnitude(e(l));
        if (candidate > test_scale) test_scale = candidate;
        std::uint64_t m = l;
        while (m < size && magnitude(e(m)) > epsilon * test_scale) ++m;
        std::uint64_t iteration = 0;
        while (m > l && magnitude(e(l)) > epsilon * test_scale &&
               iteration < max_iterations) {
            ++iteration;
            ++total_iterations;
            const std::uint64_t l1 = l + 1;
            double g = d(l);
            double p = (d(l1) - g) / (2.0 * e(l));
            double radius = square_root(p * p + 1.0);
            if (p < 0.0) radius = -radius;
            d(l) = e(l) / (p + radius);
            d(l1) = e(l) * (p + radius);
            const double next_value = d(l1);
            double h = g - d(l);
            for (std::uint64_t i = l + 2; i < size; ++i) d(i) -= h;
            shift += h;
            p = d(m);
            double cosine = 1.0;
            double previous_cosine = 1.0;
            double older_cosine = 1.0;
            double sine = 0.0;
            double previous_sine = 0.0;
            const double first_off_diagonal = e(l1);
            for (std::uint64_t ii = 0; ii < m - l; ++ii) {
                const std::uint64_t i = m - 1 - ii;
                older_cosine = previous_cosine;
                previous_cosine = cosine;
                previous_sine = sine;
                g = cosine * e(i);
                h = cosine * p;
                radius = square_root(p * p + e(i) * e(i));
                e(i + 1) = sine * radius;
                sine = e(i) / radius;
                cosine = p / radius;
                p = cosine * d(i) - sine * g;
                d(i + 1) = h + sine * (cosine * g + sine * d(i));
                for (std::uint64_t k = 0; k < size; ++k) {
                    h = at(vectors, k, i + 1);
                    at(vectors, k, i + 1) =
                        sine * at(vectors, k, i) + cosine * h;
                    at(vectors, k, i) =
                        cosine * at(vectors, k, i) - sine * h;
                }
            }
            p = -sine * previous_sine * older_cosine * first_off_diagonal *
                e(l) / next_value;
            e(l) = sine * p;
            d(l) = cosine * p;
        }
        if (m > l && magnitude(e(l)) > epsilon * test_scale) converged = 0;
        d(l) += shift;
        e(l) = 0.0;
    }

    // Sort eigenpairs in ascending order.
    for (std::uint64_t i = 0; i + 1 < size; ++i) {
        std::uint64_t selected = i;
        double value = d(i);
        for (std::uint64_t j = i + 1; j < size; ++j) {
            if (d(j) < value) {
                selected = j;
                value = d(j);
            }
        }
        if (selected != i) {
            d(selected) = d(i);
            d(i) = value;
            for (std::uint64_t row = 0; row < size; ++row) {
                const double temporary = at(vectors, row, i);
                at(vectors, row, i) = at(vectors, row, selected);
                at(vectors, row, selected) = temporary;
            }
        }
    }
    for (std::uint64_t row = 0; row < size; ++row) {
        for (std::uint64_t column = row + 1; column < size; ++column) {
            const double temporary = at(vectors, row, column);
            at(vectors, row, column) = at(vectors, column, row);
            at(vectors, column, row) = temporary;
        }
    }
    for (std::uint64_t i = 0; i < size; ++i) matrix_at(matrix, i, i) = d(i);
    *completed_iterations = total_iterations;
    (void)tolerance;
    return converged;
}
