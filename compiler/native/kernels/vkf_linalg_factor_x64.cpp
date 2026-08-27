#include <cstddef>
#include <cstdint>
#include <immintrin.h>

#ifdef _WIN32
extern "C" int _fltused = 0;
#endif

namespace {

inline double& at(double* base, std::uint64_t columns,
                  std::uint64_t row, std::uint64_t column) {
    return base[-static_cast<std::ptrdiff_t>(row * columns + column)];
}

inline double& column_at(double* base, std::uint64_t rows,
                         std::uint64_t row, std::uint64_t column) {
    return base[-static_cast<std::ptrdiff_t>(column * rows + row)];
}

inline double magnitude(double value) { return value < 0.0 ? -value : value; }

inline double square_root(double value) {
    return _mm_cvtsd_f64(_mm_sqrt_sd(_mm_setzero_pd(), _mm_set_sd(value)));
}

inline double row_prefix_dot(
    double* matrix, std::uint64_t columns,
    std::uint64_t left_row, std::uint64_t right_row,
    std::uint64_t count
) {
    __m256d packed0 = _mm256_setzero_pd();
    __m256d packed1 = _mm256_setzero_pd();
    __m256d packed2 = _mm256_setzero_pd();
    __m256d packed3 = _mm256_setzero_pd();
    std::uint64_t column = 0;
    for (; column + 15 < count; column += 16) {
        const auto left0 = _mm256_loadu_pd(&at(matrix, columns, left_row, column + 3));
        const auto right0 = _mm256_loadu_pd(&at(matrix, columns, right_row, column + 3));
        const auto left1 = _mm256_loadu_pd(&at(matrix, columns, left_row, column + 7));
        const auto right1 = _mm256_loadu_pd(&at(matrix, columns, right_row, column + 7));
        const auto left2 = _mm256_loadu_pd(&at(matrix, columns, left_row, column + 11));
        const auto right2 = _mm256_loadu_pd(&at(matrix, columns, right_row, column + 11));
        const auto left3 = _mm256_loadu_pd(&at(matrix, columns, left_row, column + 15));
        const auto right3 = _mm256_loadu_pd(&at(matrix, columns, right_row, column + 15));
        packed0 = _mm256_fmadd_pd(left0, right0, packed0);
        packed1 = _mm256_fmadd_pd(left1, right1, packed1);
        packed2 = _mm256_fmadd_pd(left2, right2, packed2);
        packed3 = _mm256_fmadd_pd(left3, right3, packed3);
    }
    for (; column + 3 < count; column += 4) {
        const auto left = _mm256_loadu_pd(
            &at(matrix, columns, left_row, column + 3));
        const auto right = _mm256_loadu_pd(
            &at(matrix, columns, right_row, column + 3));
        packed0 = _mm256_fmadd_pd(left, right, packed0);
    }
    const auto packed = _mm256_add_pd(
        _mm256_add_pd(packed0, packed1),
        _mm256_add_pd(packed2, packed3));
    alignas(32) double lanes[4];
    _mm256_store_pd(lanes, packed);
    double total = lanes[0] + lanes[1] + lanes[2] + lanes[3];
    for (; column < count; ++column) {
        total += at(matrix, columns, left_row, column) *
            at(matrix, columns, right_row, column);
    }
    return total;
}

inline void subtract_scaled_row(
    double* matrix, std::uint64_t columns,
    std::uint64_t target_row, std::uint64_t pivot_row,
    std::uint64_t first_column, double factor
) {
    const auto packed_factor = _mm256_set1_pd(factor);
    std::uint64_t column = first_column;
    for (; column + 3 < columns; column += 4) {
        auto* target = &at(matrix, columns, target_row, column + 3);
        const auto pivot = _mm256_loadu_pd(
            &at(matrix, columns, pivot_row, column + 3));
        const auto values = _mm256_loadu_pd(target);
        _mm256_storeu_pd(
            target,
            _mm256_sub_pd(values, _mm256_mul_pd(packed_factor, pivot)));
    }
    for (; column < columns; ++column) {
        at(matrix, columns, target_row, column) -=
            factor * at(matrix, columns, pivot_row, column);
    }
}

}

extern "C" std::uint64_t vkf_cholesky_x64(
    double* matrix, double* lower, std::uint64_t size, double tolerance
) {
    for (std::uint64_t column = 0; column < size; ++column) {
        const double diagonal_total = at(matrix, size, column, column) -
            row_prefix_dot(lower, size, column, column, column);
        if (diagonal_total <= tolerance) return 0;
        const double diagonal = square_root(diagonal_total);
        at(lower, size, column, column) = diagonal;
        const double inverse_diagonal = 1.0 / diagonal;
        for (std::uint64_t row = column + 1; row < size; ++row) {
            const double total = at(matrix, size, row, column) -
                row_prefix_dot(lower, size, row, column, column);
            at(lower, size, row, column) = total * inverse_diagonal;
        }
    }
    return 1;
}

extern "C" std::uint64_t vkf_cholesky_96_x64(
    double* matrix, double* lower, std::uint64_t, double tolerance
) {
    constexpr std::uint64_t size = 96;
    for (std::uint64_t column = 0; column < size; ++column) {
        const double diagonal_total = at(matrix, size, column, column) -
            row_prefix_dot(lower, size, column, column, column);
        if (diagonal_total <= tolerance) return 0;
        const double diagonal = square_root(diagonal_total);
        at(lower, size, column, column) = diagonal;
        const double inverse_diagonal = 1.0 / diagonal;
        for (std::uint64_t row = column + 1; row < size; ++row) {
            const double total = at(matrix, size, row, column) -
                row_prefix_dot(lower, size, row, column, column);
            at(lower, size, row, column) = total * inverse_diagonal;
        }
    }
    return 1;
}

extern "C" std::uint64_t vkf_lu_x64(
    double* matrix, double* lower, double* upper, double* permutation,
    std::uint64_t size, double tolerance, double* sign
) {
    for (std::uint64_t row = 0; row < size; ++row) {
        permutation[-static_cast<std::ptrdiff_t>(row)] = static_cast<double>(row);
        for (std::uint64_t column = 0; column < size; ++column) {
            at(upper, size, row, column) = at(matrix, size, row, column);
        }
    }
    double parity = 1.0;
    for (std::uint64_t column = 0; column < size; ++column) {
        std::uint64_t pivot = column;
        double pivot_magnitude = magnitude(at(upper, size, column, column));
        for (std::uint64_t row = column + 1; row < size; ++row) {
            const double candidate = magnitude(at(upper, size, row, column));
            if (candidate > pivot_magnitude) {
                pivot = row;
                pivot_magnitude = candidate;
            }
        }
        if (pivot_magnitude <= tolerance) return 0;
        if (pivot != column) {
            for (std::uint64_t target = 0; target < size; ++target) {
                const double temporary = at(upper, size, pivot, target);
                at(upper, size, pivot, target) = at(upper, size, column, target);
                at(upper, size, column, target) = temporary;
            }
            const double temporary = permutation[-static_cast<std::ptrdiff_t>(pivot)];
            permutation[-static_cast<std::ptrdiff_t>(pivot)] =
                permutation[-static_cast<std::ptrdiff_t>(column)];
            permutation[-static_cast<std::ptrdiff_t>(column)] = temporary;
            parity = -parity;
        }
        const double inverse_pivot =
            1.0 / at(upper, size, column, column);
        for (std::uint64_t row = column + 1; row < size; ++row) {
            const double factor = at(upper, size, row, column) * inverse_pivot;
            at(upper, size, row, column) = factor;
            subtract_scaled_row(upper, size, row, column, column + 1, factor);
        }
    }
    // Split the packed factorization into the public unit-lower and upper
    // matrices only after elimination, keeping the hot rank-1 updates compact.
    for (std::uint64_t row = 0; row < size; ++row) {
        for (std::uint64_t column = 0; column < row; ++column) {
            at(lower, size, row, column) = at(upper, size, row, column);
            at(upper, size, row, column) = 0.0;
        }
        at(lower, size, row, row) = 1.0;
        for (std::uint64_t column = row + 1; column < size; ++column) {
            at(lower, size, row, column) = 0.0;
        }
    }
    *sign = parity;
    return 1;
}

extern "C" std::uint64_t vkf_lu_96_x64(
    double* matrix, double* lower, double* upper, double* permutation,
    std::uint64_t, double tolerance, double* sign
) {
    constexpr std::uint64_t size = 96;
    for (std::uint64_t row = 0; row < size; ++row) {
        permutation[-static_cast<std::ptrdiff_t>(row)] = static_cast<double>(row);
        for (std::uint64_t column = 0; column < size; ++column) {
            at(upper, size, row, column) = at(matrix, size, row, column);
        }
        at(lower, size, row, row) = 1.0;
        for (std::uint64_t column = row + 1; column < size; ++column) {
            at(lower, size, row, column) = 0.0;
        }
    }
    double parity = 1.0;
    for (std::uint64_t column = 0; column < size; ++column) {
        std::uint64_t pivot = column;
        double pivot_magnitude = magnitude(at(upper, size, column, column));
        for (std::uint64_t row = column + 1; row < size; ++row) {
            const double candidate = magnitude(at(upper, size, row, column));
            if (candidate > pivot_magnitude) {
                pivot = row;
                pivot_magnitude = candidate;
            }
        }
        if (pivot_magnitude <= tolerance) return 0;
        if (pivot != column) {
            for (std::uint64_t target = column; target < size; ++target) {
                const double temporary = at(upper, size, pivot, target);
                at(upper, size, pivot, target) = at(upper, size, column, target);
                at(upper, size, column, target) = temporary;
            }
            for (std::uint64_t prior = 0; prior < column; ++prior) {
                const double temporary = at(lower, size, pivot, prior);
                at(lower, size, pivot, prior) = at(lower, size, column, prior);
                at(lower, size, column, prior) = temporary;
            }
            const double temporary =
                permutation[-static_cast<std::ptrdiff_t>(pivot)];
            permutation[-static_cast<std::ptrdiff_t>(pivot)] =
                permutation[-static_cast<std::ptrdiff_t>(column)];
            permutation[-static_cast<std::ptrdiff_t>(column)] = temporary;
            parity = -parity;
        }
        const double inverse_pivot =
            1.0 / at(upper, size, column, column);
        for (std::uint64_t row = column + 1; row < size; ++row) {
            const double factor = at(upper, size, row, column) * inverse_pivot;
            at(lower, size, row, column) = factor;
            at(upper, size, row, column) = 0.0;
            subtract_scaled_row(upper, size, row, column, column + 1, factor);
        }
    }
    *sign = parity;
    return 1;
}

extern "C" std::uint64_t vkf_least_squares_x64(
    double* matrix, double* values, double* result,
    double* q_columns, double* r_upper,
    std::uint64_t rows, std::uint64_t columns, double tolerance
) {
    for (std::uint64_t row = 0; row < columns; ++row) {
        for (std::uint64_t column = 0; column < columns; ++column) {
            at(r_upper, columns, row, column) = 0.0;
        }
    }
    for (std::uint64_t column = 0; column < columns; ++column) {
        for (std::uint64_t row = 0; row < rows; ++row) {
            column_at(q_columns, rows, row, column) =
                at(matrix, columns, row, column);
        }
        for (std::uint64_t prior = 0; prior < column; ++prior) {
            double projection = 0.0;
            for (std::uint64_t row = 0; row < rows; ++row) {
                projection += column_at(q_columns, rows, row, prior) *
                    column_at(q_columns, rows, row, column);
            }
            at(r_upper, columns, prior, column) = projection;
            for (std::uint64_t row = 0; row < rows; ++row) {
                column_at(q_columns, rows, row, column) -= projection *
                    column_at(q_columns, rows, row, prior);
            }
        }
        double norm_squared = 0.0;
        for (std::uint64_t row = 0; row < rows; ++row) {
            const double value = column_at(q_columns, rows, row, column);
            norm_squared += value * value;
        }
        const double norm = square_root(norm_squared);
        if (norm <= tolerance) return 0;
        at(r_upper, columns, column, column) = norm;
        for (std::uint64_t row = 0; row < rows; ++row) {
            column_at(q_columns, rows, row, column) /= norm;
        }
    }
    for (std::uint64_t column = 0; column < columns; ++column) {
        double projected = 0.0;
        for (std::uint64_t row = 0; row < rows; ++row) {
            projected += column_at(q_columns, rows, row, column) *
                values[-static_cast<std::ptrdiff_t>(row)];
        }
        result[-static_cast<std::ptrdiff_t>(column)] = projected;
    }
    for (std::uint64_t reverse = 0; reverse < columns; ++reverse) {
        const std::uint64_t row = columns - 1 - reverse;
        double value = result[-static_cast<std::ptrdiff_t>(row)];
        for (std::uint64_t column = row + 1; column < columns; ++column) {
            value -= at(r_upper, columns, row, column) *
                result[-static_cast<std::ptrdiff_t>(column)];
        }
        const double pivot = at(r_upper, columns, row, row);
        if (magnitude(pivot) <= tolerance) return 0;
        result[-static_cast<std::ptrdiff_t>(row)] = value / pivot;
    }
    return 1;
}
