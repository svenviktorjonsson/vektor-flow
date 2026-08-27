#include "vkf_symmetric_eigen_x64.cpp"

namespace {

inline double& matrix_at(
    double* base,
    std::uint64_t columns,
    std::uint64_t row,
    std::uint64_t column
) {
    return base[-static_cast<std::ptrdiff_t>(row * columns + column)];
}

inline double absolute_value(double value) {
    return value < 0.0 ? -value : value;
}

}

// Compiler kernel ABI. Every array uses VKF's descending fixed-vector layout.
// `scratch` provides at least 2*columns doubles.
extern "C" std::uint64_t vkf_thin_svd_x64(
    double* matrix,
    double* left_vectors,
    double* singular_values,
    double* right_adjoint,
    double* gram,
    double* eigenvectors,
    double* scratch,
    std::uint64_t rows,
    std::uint64_t columns,
    double tolerance,
    std::uint64_t max_iterations,
    std::uint64_t verify_result,
    double* relative_residual,
    double* orthogonality_residual
) {
    for (std::uint64_t left = 0; left < columns; ++left) {
        for (std::uint64_t right = left; right < columns; ++right) {
            double total = 0.0;
            for (std::uint64_t row = 0; row < rows; ++row) {
                total += matrix_at(matrix, columns, row, left) *
                    matrix_at(matrix, columns, row, right);
            }
            matrix_at(gram, columns, left, right) = total;
            matrix_at(gram, columns, right, left) = total;
        }
    }

    std::uint64_t iterations = 0;
    const auto converged = vkf_symmetric_eigen_x64(
        gram, eigenvectors, scratch, columns, tolerance, max_iterations,
        &iterations);

    for (std::uint64_t target = 0; target < columns; ++target) {
        const auto source = columns - 1 - target;
        double eigenvalue = matrix_at(gram, columns, source, source);
        if (eigenvalue < 0.0 && absolute_value(eigenvalue) <= tolerance) {
            eigenvalue = 0.0;
        }
        if (eigenvalue < 0.0) eigenvalue = 0.0;
        const double sigma = square_root(eigenvalue);
        singular_values[-static_cast<std::ptrdiff_t>(target)] = sigma;
        for (std::uint64_t component = 0; component < columns; ++component) {
            matrix_at(right_adjoint, columns, target, component) =
                matrix_at(eigenvectors, columns, component, source);
        }
        if (sigma > tolerance) {
            for (std::uint64_t row = 0; row < rows; ++row) {
                double total = 0.0;
                for (std::uint64_t component = 0; component < columns; ++component) {
                    total += matrix_at(matrix, columns, row, component) *
                        matrix_at(eigenvectors, columns, component, source);
                }
                matrix_at(left_vectors, columns, row, target) = total / sigma;
            }
        }
    }

    // Complete only genuinely null left-singular directions. Full-rank inputs
    // skip this branch entirely.
    for (std::uint64_t column = 0; column < columns; ++column) {
        if (singular_values[-static_cast<std::ptrdiff_t>(column)] > tolerance) continue;
        bool found = false;
        for (std::uint64_t basis = 0; basis < rows && !found; ++basis) {
            for (std::uint64_t row = 0; row < rows; ++row) {
                scratch[-static_cast<std::ptrdiff_t>(row)] = row == basis ? 1.0 : 0.0;
            }
            for (std::uint64_t prior = 0; prior < column; ++prior) {
                double projection = 0.0;
                for (std::uint64_t row = 0; row < rows; ++row) {
                    projection += matrix_at(left_vectors, columns, row, prior) *
                        scratch[-static_cast<std::ptrdiff_t>(row)];
                }
                for (std::uint64_t row = 0; row < rows; ++row) {
                    scratch[-static_cast<std::ptrdiff_t>(row)] -= projection *
                        matrix_at(left_vectors, columns, row, prior);
                }
            }
            double norm_squared = 0.0;
            for (std::uint64_t row = 0; row < rows; ++row) {
                const double value = scratch[-static_cast<std::ptrdiff_t>(row)];
                norm_squared += value * value;
            }
            const double norm = square_root(norm_squared);
            if (norm > tolerance) {
                for (std::uint64_t row = 0; row < rows; ++row) {
                    matrix_at(left_vectors, columns, row, column) =
                        scratch[-static_cast<std::ptrdiff_t>(row)] / norm;
                }
                found = true;
            }
        }
        if (!found) return 0;
    }

    double residual = 0.0;
    double orthogonality = 0.0;
    std::uint64_t verified = 0;
    if (verify_result != 0) {
        double matrix_scale = 0.0;
        for (std::uint64_t row = 0; row < rows; ++row) {
            double matrix_row_sum = 0.0;
            double error_row_sum = 0.0;
            for (std::uint64_t column = 0; column < columns; ++column) {
                double reconstructed = 0.0;
                for (std::uint64_t inner = 0; inner < columns; ++inner) {
                    reconstructed += matrix_at(left_vectors, columns, row, inner) *
                        singular_values[-static_cast<std::ptrdiff_t>(inner)] *
                        matrix_at(right_adjoint, columns, inner, column);
                }
                matrix_row_sum += absolute_value(matrix_at(matrix, columns, row, column));
                error_row_sum += absolute_value(
                    reconstructed - matrix_at(matrix, columns, row, column));
            }
            if (matrix_row_sum > matrix_scale) matrix_scale = matrix_row_sum;
            if (error_row_sum > residual) residual = error_row_sum;
        }
        if (matrix_scale > 0.0) residual /= matrix_scale;
        for (std::uint64_t first = 0; first < columns; ++first) {
            for (std::uint64_t second = 0; second < columns; ++second) {
                double left_total = 0.0;
                double right_total = 0.0;
                for (std::uint64_t row = 0; row < rows; ++row) {
                    left_total += matrix_at(left_vectors, columns, row, first) *
                        matrix_at(left_vectors, columns, row, second);
                }
                for (std::uint64_t component = 0; component < columns; ++component) {
                    right_total += matrix_at(right_adjoint, columns, first, component) *
                        matrix_at(right_adjoint, columns, second, component);
                }
                const double expected = first == second ? 1.0 : 0.0;
                const double left_error = absolute_value(left_total - expected);
                const double right_error = absolute_value(right_total - expected);
                if (left_error > orthogonality) orthogonality = left_error;
                if (right_error > orthogonality) orthogonality = right_error;
            }
        }
        verified = converged != 0 && residual <= tolerance * 10.0 &&
            orthogonality <= tolerance * 100.0;
    }
    *relative_residual = residual;
    *orthogonality_residual = orthogonality;
    return (converged != 0 ? 1u : 0u) | (verified != 0 ? 2u : 0u);
}
