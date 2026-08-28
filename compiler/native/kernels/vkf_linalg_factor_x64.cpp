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

struct FourDots {
    double values[4];
};

inline double horizontal_sum(__m256d value) {
    const auto halves = _mm_add_pd(
        _mm256_castpd256_pd128(value),
        _mm256_extractf128_pd(value, 1));
    return _mm_cvtsd_f64(_mm_hadd_pd(halves, halves));
}

inline FourDots four_row_prefix_dots(
    double* matrix, std::uint64_t columns,
    std::uint64_t first_row, std::uint64_t right_row,
    std::uint64_t count
) {
    __m256d packed00 = _mm256_setzero_pd();
    __m256d packed01 = _mm256_setzero_pd();
    __m256d packed10 = _mm256_setzero_pd();
    __m256d packed11 = _mm256_setzero_pd();
    __m256d packed20 = _mm256_setzero_pd();
    __m256d packed21 = _mm256_setzero_pd();
    __m256d packed30 = _mm256_setzero_pd();
    __m256d packed31 = _mm256_setzero_pd();
    std::uint64_t column = 0;
    for (; column + 7 < count; column += 8) {
        const auto right0 = _mm256_loadu_pd(
            &at(matrix, columns, right_row, column + 3));
        const auto right1 = _mm256_loadu_pd(
            &at(matrix, columns, right_row, column + 7));
        packed00 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row, column + 3)),
            right0, packed00);
        packed01 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row, column + 7)),
            right1, packed01);
        packed10 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row + 1, column + 3)),
            right0, packed10);
        packed11 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row + 1, column + 7)),
            right1, packed11);
        packed20 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row + 2, column + 3)),
            right0, packed20);
        packed21 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row + 2, column + 7)),
            right1, packed21);
        packed30 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row + 3, column + 3)),
            right0, packed30);
        packed31 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row + 3, column + 7)),
            right1, packed31);
    }
    for (; column + 3 < count; column += 4) {
        const auto right = _mm256_loadu_pd(
            &at(matrix, columns, right_row, column + 3));
        packed00 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row, column + 3)),
            right, packed00);
        packed10 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row + 1, column + 3)),
            right, packed10);
        packed20 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row + 2, column + 3)),
            right, packed20);
        packed30 = _mm256_fmadd_pd(
            _mm256_loadu_pd(&at(matrix, columns, first_row + 3, column + 3)),
            right, packed30);
    }
    FourDots totals{{
        horizontal_sum(_mm256_add_pd(packed00, packed01)),
        horizontal_sum(_mm256_add_pd(packed10, packed11)),
        horizontal_sum(_mm256_add_pd(packed20, packed21)),
        horizontal_sum(_mm256_add_pd(packed30, packed31)),
    }};
    for (; column < count; ++column) {
        const double right = at(matrix, columns, right_row, column);
        totals.values[0] += at(matrix, columns, first_row, column) * right;
        totals.values[1] += at(matrix, columns, first_row + 1, column) * right;
        totals.values[2] += at(matrix, columns, first_row + 2, column) * right;
        totals.values[3] += at(matrix, columns, first_row + 3, column) * right;
    }
    return totals;
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
            _mm256_fnmadd_pd(packed_factor, pivot, values));
    }
    for (; column < columns; ++column) {
        at(matrix, columns, target_row, column) -=
            factor * at(matrix, columns, pivot_row, column);
    }
}

inline void subtract_scaled_four_rows(
    double* matrix, std::uint64_t columns,
    std::uint64_t first_target_row, std::uint64_t pivot_row,
    std::uint64_t first_column, const double* factors
) {
    const auto factor0 = _mm256_set1_pd(factors[0]);
    const auto factor1 = _mm256_set1_pd(factors[1]);
    const auto factor2 = _mm256_set1_pd(factors[2]);
    const auto factor3 = _mm256_set1_pd(factors[3]);
    std::uint64_t column = first_column;
    for (; column + 3 < columns; column += 4) {
        const auto pivot = _mm256_loadu_pd(
            &at(matrix, columns, pivot_row, column + 3));
        auto* target0 = &at(matrix, columns, first_target_row, column + 3);
        auto* target1 = &at(matrix, columns, first_target_row + 1, column + 3);
        auto* target2 = &at(matrix, columns, first_target_row + 2, column + 3);
        auto* target3 = &at(matrix, columns, first_target_row + 3, column + 3);
        _mm256_storeu_pd(target0, _mm256_fnmadd_pd(
            factor0, pivot, _mm256_loadu_pd(target0)));
        _mm256_storeu_pd(target1, _mm256_fnmadd_pd(
            factor1, pivot, _mm256_loadu_pd(target1)));
        _mm256_storeu_pd(target2, _mm256_fnmadd_pd(
            factor2, pivot, _mm256_loadu_pd(target2)));
        _mm256_storeu_pd(target3, _mm256_fnmadd_pd(
            factor3, pivot, _mm256_loadu_pd(target3)));
    }
    for (; column < columns; ++column) {
        const double pivot = at(matrix, columns, pivot_row, column);
        at(matrix, columns, first_target_row, column) -= factors[0] * pivot;
        at(matrix, columns, first_target_row + 1, column) -= factors[1] * pivot;
        at(matrix, columns, first_target_row + 2, column) -= factors[2] * pivot;
        at(matrix, columns, first_target_row + 3, column) -= factors[3] * pivot;
    }
}

inline std::uint64_t solve(
    double* matrix, double* values, double* working, double* result,
    std::uint64_t size, double tolerance
) {
    for (std::uint64_t row = 0; row < size; ++row) {
        result[-static_cast<std::ptrdiff_t>(row)] =
            values[-static_cast<std::ptrdiff_t>(row)];
        for (std::uint64_t column = 0; column < size; ++column) {
            at(working, size, row, column) = at(matrix, size, row, column);
        }
    }
    for (std::uint64_t column = 0; column < size; ++column) {
        std::uint64_t pivot = column;
        double pivot_magnitude = magnitude(at(working, size, column, column));
        for (std::uint64_t row = column + 1; row < size; ++row) {
            const double candidate = magnitude(at(working, size, row, column));
            if (candidate > pivot_magnitude) {
                pivot = row;
                pivot_magnitude = candidate;
            }
        }
        if (pivot_magnitude <= tolerance) return 0;
        if (pivot != column) {
            for (std::uint64_t target = column; target < size; ++target) {
                const double temporary = at(working, size, pivot, target);
                at(working, size, pivot, target) = at(working, size, column, target);
                at(working, size, column, target) = temporary;
            }
            const double temporary = result[-static_cast<std::ptrdiff_t>(pivot)];
            result[-static_cast<std::ptrdiff_t>(pivot)] =
                result[-static_cast<std::ptrdiff_t>(column)];
            result[-static_cast<std::ptrdiff_t>(column)] = temporary;
        }
        const double inverse_pivot = 1.0 / at(working, size, column, column);
        for (std::uint64_t row = column + 1; row < size; ++row) {
            const double factor = at(working, size, row, column) * inverse_pivot;
            at(working, size, row, column) = 0.0;
            subtract_scaled_row(working, size, row, column, column + 1, factor);
            result[-static_cast<std::ptrdiff_t>(row)] -=
                factor * result[-static_cast<std::ptrdiff_t>(column)];
        }
    }
    for (std::uint64_t row = size; row-- > 0;) {
        double total = result[-static_cast<std::ptrdiff_t>(row)];
        for (std::uint64_t column = row + 1; column < size; ++column) {
            total -= at(working, size, row, column) *
                result[-static_cast<std::ptrdiff_t>(column)];
        }
        result[-static_cast<std::ptrdiff_t>(row)] =
            total / at(working, size, row, row);
    }
    return 1;
}

}

extern "C" std::uint64_t vkf_solve_x64(
    double* matrix, double* values, double* working, double* result,
    std::uint64_t size, double tolerance
) {
    return solve(matrix, values, working, result, size, tolerance);
}

extern "C" std::uint64_t vkf_solve_96_x64(
    double* matrix, double* values, double* working, double* result,
    std::uint64_t, double tolerance
) {
    return solve(matrix, values, working, result, 96u, tolerance);
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
        std::uint64_t row = column + 1;
        for (; row + 3 < size; row += 4) {
            const auto totals = four_row_prefix_dots(
                lower, size, row, column, column);
            for (std::uint64_t offset = 0; offset < 4; ++offset) {
                at(lower, size, row + offset, column) =
                    (at(matrix, size, row + offset, column) -
                     totals.values[offset]) * inverse_diagonal;
            }
        }
        for (; row < size; ++row) {
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
        std::uint64_t row = column + 1;
        for (; row + 3 < size; row += 4) {
            const auto totals = four_row_prefix_dots(
                lower, size, row, column, column);
            for (std::uint64_t offset = 0; offset < 4; ++offset) {
                at(lower, size, row + offset, column) =
                    (at(matrix, size, row + offset, column) -
                     totals.values[offset]) * inverse_diagonal;
            }
        }
        for (; row < size; ++row) {
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
    constexpr std::uint64_t block_size = 16;
    for (std::uint64_t row = 0; row < size; ++row) {
        permutation[-static_cast<std::ptrdiff_t>(row)] = static_cast<double>(row);
        for (std::uint64_t column = 0; column < size; ++column) {
            at(upper, size, row, column) = at(matrix, size, row, column);
        }
    }
    double parity = 1.0;
    for (std::uint64_t block = 0; block < size; block += block_size) {
        const std::uint64_t panel_end = block + block_size;

        // Partial-pivot factorization of the narrow panel. Updates remain in
        // the panel; the trailing matrix is handled as one blocked product.
        for (std::uint64_t column = block; column < panel_end; ++column) {
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
                const double factor =
                    at(upper, size, row, column) * inverse_pivot;
                at(upper, size, row, column) = factor;
                for (std::uint64_t target = column + 1;
                     target < panel_end; ++target) {
                    at(upper, size, row, target) -=
                        factor * at(upper, size, column, target);
                }
            }
        }

        if (panel_end == size) break;

        // U12 = inv(L11) * A12. Each target vector is loaded once for the
        // whole panel instead of once per panel column.
        for (std::uint64_t row = block; row < panel_end; ++row) {
            std::uint64_t column = panel_end;
            for (; column + 3 < size; column += 4) {
                auto* target = &at(upper, size, row, column + 3);
                auto values = _mm256_loadu_pd(target);
                for (std::uint64_t prior = block; prior < row; ++prior) {
                    const auto factor = _mm256_set1_pd(
                        at(upper, size, row, prior));
                    const auto pivot = _mm256_loadu_pd(
                        &at(upper, size, prior, column + 3));
                    values = _mm256_fnmadd_pd(factor, pivot, values);
                }
                _mm256_storeu_pd(target, values);
            }
            for (; column < size; ++column) {
                for (std::uint64_t prior = block; prior < row; ++prior) {
                    at(upper, size, row, column) -=
                        at(upper, size, row, prior) *
                        at(upper, size, prior, column);
                }
            }
        }

        // A22 -= L21 * U12, four target rows at a time. Target vectors stay
        // resident across all 16 rank-one contributions.
        std::uint64_t row = panel_end;
        for (; row + 3 < size; row += 4) {
            std::uint64_t column = panel_end;
            for (; column + 3 < size; column += 4) {
                auto* target0 = &at(upper, size, row, column + 3);
                auto* target1 = &at(upper, size, row + 1, column + 3);
                auto* target2 = &at(upper, size, row + 2, column + 3);
                auto* target3 = &at(upper, size, row + 3, column + 3);
                auto values0 = _mm256_loadu_pd(target0);
                auto values1 = _mm256_loadu_pd(target1);
                auto values2 = _mm256_loadu_pd(target2);
                auto values3 = _mm256_loadu_pd(target3);
                for (std::uint64_t prior = block;
                     prior < panel_end; ++prior) {
                    const auto pivot = _mm256_loadu_pd(
                        &at(upper, size, prior, column + 3));
                    values0 = _mm256_fnmadd_pd(_mm256_set1_pd(
                        at(upper, size, row, prior)), pivot, values0);
                    values1 = _mm256_fnmadd_pd(_mm256_set1_pd(
                        at(upper, size, row + 1, prior)), pivot, values1);
                    values2 = _mm256_fnmadd_pd(_mm256_set1_pd(
                        at(upper, size, row + 2, prior)), pivot, values2);
                    values3 = _mm256_fnmadd_pd(_mm256_set1_pd(
                        at(upper, size, row + 3, prior)), pivot, values3);
                }
                _mm256_storeu_pd(target0, values0);
                _mm256_storeu_pd(target1, values1);
                _mm256_storeu_pd(target2, values2);
                _mm256_storeu_pd(target3, values3);
            }
            for (; column < size; ++column) {
                for (std::uint64_t offset = 0; offset < 4; ++offset) {
                    for (std::uint64_t prior = block;
                         prior < panel_end; ++prior) {
                        at(upper, size, row + offset, column) -=
                            at(upper, size, row + offset, prior) *
                            at(upper, size, prior, column);
                    }
                }
            }
        }
        for (; row < size; ++row) {
            for (std::uint64_t column = panel_end; column < size; ++column) {
                for (std::uint64_t prior = block;
                     prior < panel_end; ++prior) {
                    at(upper, size, row, column) -=
                        at(upper, size, row, prior) *
                        at(upper, size, prior, column);
                }
            }
        }
    }

    // Materialize the public unit-lower and upper matrices from packed LU.
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
