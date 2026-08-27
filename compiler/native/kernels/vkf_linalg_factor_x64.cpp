#include <cstddef>
#include <cstdint>
#include <emmintrin.h>

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

}

extern "C" std::uint64_t vkf_cholesky_x64(
    double* matrix, double* lower, std::uint64_t size, double tolerance
) {
    for (std::uint64_t row = 0; row < size; ++row) {
        for (std::uint64_t column = row + 1; column < size; ++column) {
            at(lower, size, row, column) = 0.0;
        }
    }
    for (std::uint64_t column = 0; column < size; ++column) {
        double diagonal_total = at(matrix, size, column, column);
        for (std::uint64_t inner = 0; inner < column; ++inner) {
            const double value = at(lower, size, column, inner);
            diagonal_total -= value * value;
        }
        if (diagonal_total <= tolerance) return 0;
        const double diagonal = square_root(diagonal_total);
        at(lower, size, column, column) = diagonal;
        const double inverse_diagonal = 1.0 / diagonal;
        for (std::uint64_t row = column + 1; row < size; ++row) {
            double total = at(matrix, size, row, column);
            for (std::uint64_t inner = 0; inner < column; ++inner) {
                total -= at(lower, size, row, inner) *
                    at(lower, size, column, inner);
            }
            at(lower, size, row, column) = total * inverse_diagonal;
        }
    }
    return 1;
}

extern "C" std::uint64_t vkf_cholesky_96_x64(
    double* matrix, double* lower, std::uint64_t, double tolerance
) {
    constexpr std::uint64_t size = 96;
    for (std::uint64_t row = 0; row < size; ++row) {
        for (std::uint64_t column = row + 1; column < size; ++column) {
            at(lower, size, row, column) = 0.0;
        }
    }
    for (std::uint64_t column = 0; column < size; ++column) {
        double diagonal_total = at(matrix, size, column, column);
        for (std::uint64_t inner = 0; inner < column; ++inner) {
            const double value = at(lower, size, column, inner);
            diagonal_total -= value * value;
        }
        if (diagonal_total <= tolerance) return 0;
        const double diagonal = square_root(diagonal_total);
        at(lower, size, column, column) = diagonal;
        const double inverse_diagonal = 1.0 / diagonal;
        for (std::uint64_t row = column + 1; row < size; ++row) {
            double total = at(matrix, size, row, column);
            for (std::uint64_t inner = 0; inner < column; ++inner) {
                total -= at(lower, size, row, inner) *
                    at(lower, size, column, inner);
            }
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
        std::uint64_t row = column + 1;
        for (; row + 7 < size; row += 8) {
            const double factor0 = at(upper, size, row, column) * inverse_pivot;
            const double factor1 = at(upper, size, row + 1, column) * inverse_pivot;
            const double factor2 = at(upper, size, row + 2, column) * inverse_pivot;
            const double factor3 = at(upper, size, row + 3, column) * inverse_pivot;
            const double factor4 = at(upper, size, row + 4, column) * inverse_pivot;
            const double factor5 = at(upper, size, row + 5, column) * inverse_pivot;
            const double factor6 = at(upper, size, row + 6, column) * inverse_pivot;
            const double factor7 = at(upper, size, row + 7, column) * inverse_pivot;
            at(upper, size, row, column) = factor0;
            at(upper, size, row + 1, column) = factor1;
            at(upper, size, row + 2, column) = factor2;
            at(upper, size, row + 3, column) = factor3;
            at(upper, size, row + 4, column) = factor4;
            at(upper, size, row + 5, column) = factor5;
            at(upper, size, row + 6, column) = factor6;
            at(upper, size, row + 7, column) = factor7;
            for (std::uint64_t target = column + 1; target < size; ++target) {
                const double pivot_component = at(upper, size, column, target);
                at(upper, size, row, target) -= factor0 * pivot_component;
                at(upper, size, row + 1, target) -= factor1 * pivot_component;
                at(upper, size, row + 2, target) -= factor2 * pivot_component;
                at(upper, size, row + 3, target) -= factor3 * pivot_component;
                at(upper, size, row + 4, target) -= factor4 * pivot_component;
                at(upper, size, row + 5, target) -= factor5 * pivot_component;
                at(upper, size, row + 6, target) -= factor6 * pivot_component;
                at(upper, size, row + 7, target) -= factor7 * pivot_component;
            }
        }
        for (; row < size; ++row) {
            const double factor = at(upper, size, row, column) * inverse_pivot;
            at(upper, size, row, column) = factor;
            for (std::uint64_t target = column + 1; target < size; ++target) {
                at(upper, size, row, target) -=
                    factor * at(upper, size, column, target);
            }
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
        std::uint64_t row = column + 1;
        for (; row + 7 < size; row += 8) {
            const double factor0 = at(upper, size, row, column) * inverse_pivot;
            const double factor1 = at(upper, size, row + 1, column) * inverse_pivot;
            const double factor2 = at(upper, size, row + 2, column) * inverse_pivot;
            const double factor3 = at(upper, size, row + 3, column) * inverse_pivot;
            const double factor4 = at(upper, size, row + 4, column) * inverse_pivot;
            const double factor5 = at(upper, size, row + 5, column) * inverse_pivot;
            const double factor6 = at(upper, size, row + 6, column) * inverse_pivot;
            const double factor7 = at(upper, size, row + 7, column) * inverse_pivot;
            at(lower, size, row, column) = factor0;
            at(lower, size, row + 1, column) = factor1;
            at(lower, size, row + 2, column) = factor2;
            at(lower, size, row + 3, column) = factor3;
            at(lower, size, row + 4, column) = factor4;
            at(lower, size, row + 5, column) = factor5;
            at(lower, size, row + 6, column) = factor6;
            at(lower, size, row + 7, column) = factor7;
            at(upper, size, row, column) = 0.0;
            at(upper, size, row + 1, column) = 0.0;
            at(upper, size, row + 2, column) = 0.0;
            at(upper, size, row + 3, column) = 0.0;
            at(upper, size, row + 4, column) = 0.0;
            at(upper, size, row + 5, column) = 0.0;
            at(upper, size, row + 6, column) = 0.0;
            at(upper, size, row + 7, column) = 0.0;
            for (std::uint64_t target = column + 1; target < size; ++target) {
                const double pivot_component = at(upper, size, column, target);
                at(upper, size, row, target) -= factor0 * pivot_component;
                at(upper, size, row + 1, target) -= factor1 * pivot_component;
                at(upper, size, row + 2, target) -= factor2 * pivot_component;
                at(upper, size, row + 3, target) -= factor3 * pivot_component;
                at(upper, size, row + 4, target) -= factor4 * pivot_component;
                at(upper, size, row + 5, target) -= factor5 * pivot_component;
                at(upper, size, row + 6, target) -= factor6 * pivot_component;
                at(upper, size, row + 7, target) -= factor7 * pivot_component;
            }
        }
        for (; row < size; ++row) {
            const double factor = at(upper, size, row, column) * inverse_pivot;
            at(lower, size, row, column) = factor;
            at(upper, size, row, column) = 0.0;
            for (std::uint64_t target = column + 1; target < size; ++target) {
                at(upper, size, row, target) -=
                    factor * at(upper, size, column, target);
            }
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
