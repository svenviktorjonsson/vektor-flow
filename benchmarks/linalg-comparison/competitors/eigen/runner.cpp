#include <Eigen/Cholesky>
#include <Eigen/Core>
#include <Eigen/Eigenvalues>
#include <Eigen/LU>
#include <Eigen/QR>
#include <Eigen/SVD>

#include <algorithm>
#include <array>
#include <bit>
#include <chrono>
#include <complex>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <span>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using Eigen::MatrixXd;
using Eigen::VectorXd;
using Clock = std::chrono::steady_clock;

static_assert(EIGEN_MAJOR_VERSION == 5 && EIGEN_MINOR_VERSION == 0,
              "This benchmark is pinned to Eigen 5.0.0");

struct FixtureSpec {
  const char* name;
  int rows;
  int columns;
  std::size_t matrix_elements;
  std::size_t x_offset;
  std::size_t x_elements;
  std::size_t rhs_offset;
  std::size_t rhs_elements;
};

struct Fixture {
  MatrixXd matrix;
  VectorXd x_true;
  VectorXd rhs;
  std::string sha256;
};

class Sha256 {
 public:
  void update(std::span<const std::uint8_t> bytes) {
    bit_length_ += static_cast<std::uint64_t>(bytes.size()) * 8;
    for (const auto byte : bytes) {
      block_[block_size_++] = byte;
      if (block_size_ == block_.size()) {
        transform();
        block_size_ = 0;
      }
    }
  }

  std::string finish() {
    block_[block_size_++] = 0x80;
    if (block_size_ > 56) {
      while (block_size_ < block_.size()) block_[block_size_++] = 0;
      transform();
      block_size_ = 0;
    }
    while (block_size_ < 56) block_[block_size_++] = 0;
    for (int shift = 56; shift >= 0; shift -= 8) {
      block_[block_size_++] = static_cast<std::uint8_t>(bit_length_ >> shift);
    }
    transform();

    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (const auto value : state_) output << std::setw(8) << value;
    return output.str();
  }

 private:
  static constexpr std::array<std::uint32_t, 64> constants_ = {
      0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u,
      0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
      0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u,
      0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
      0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
      0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
      0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
      0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
      0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au,
      0x5b9cca4fu, 0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
      0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u};

  static std::uint32_t rotate_right(std::uint32_t value, int count) {
    return (value >> count) | (value << (32 - count));
  }

  void transform() {
    std::array<std::uint32_t, 64> words{};
    for (int index = 0; index < 16; ++index) {
      const auto offset = index * 4;
      words[index] = (static_cast<std::uint32_t>(block_[offset]) << 24) |
                     (static_cast<std::uint32_t>(block_[offset + 1]) << 16) |
                     (static_cast<std::uint32_t>(block_[offset + 2]) << 8) |
                     static_cast<std::uint32_t>(block_[offset + 3]);
    }
    for (int index = 16; index < 64; ++index) {
      const auto s0 = rotate_right(words[index - 15], 7) ^ rotate_right(words[index - 15], 18) ^
                      (words[index - 15] >> 3);
      const auto s1 = rotate_right(words[index - 2], 17) ^ rotate_right(words[index - 2], 19) ^
                      (words[index - 2] >> 10);
      words[index] = words[index - 16] + s0 + words[index - 7] + s1;
    }

    auto a = state_[0];
    auto b = state_[1];
    auto c = state_[2];
    auto d = state_[3];
    auto e = state_[4];
    auto f = state_[5];
    auto g = state_[6];
    auto h = state_[7];
    for (int index = 0; index < 64; ++index) {
      const auto sum1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25);
      const auto choice = (e & f) ^ (~e & g);
      const auto temporary1 = h + sum1 + choice + constants_[index] + words[index];
      const auto sum0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22);
      const auto majority = (a & b) ^ (a & c) ^ (b & c);
      const auto temporary2 = sum0 + majority;
      h = g;
      g = f;
      f = e;
      e = d + temporary1;
      d = c;
      c = b;
      b = a;
      a = temporary1 + temporary2;
    }
    state_[0] += a;
    state_[1] += b;
    state_[2] += c;
    state_[3] += d;
    state_[4] += e;
    state_[5] += f;
    state_[6] += g;
    state_[7] += h;
  }

  std::array<std::uint8_t, 64> block_{};
  std::size_t block_size_ = 0;
  std::uint64_t bit_length_ = 0;
  std::array<std::uint32_t, 8> state_ = {
      0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
      0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};
};

FixtureSpec fixture_spec(const std::string& kernel) {
  if (kernel == "solve-general-96" || kernel == "lu-general-96" ||
      kernel == "eigen-general-96") {
    return {"general-96.f64le", 96, 96, 9216, 9216, 96, 9312, 96};
  }
  if (kernel == "least-squares-tall-96x48" || kernel == "qr-tall-96x48" ||
      kernel == "svd-tall-96x48") {
    return {"tall-96x48.f64le", 96, 48, 4608, 4608, 48, 4656, 96};
  }
  if (kernel == "cholesky-spd-96" || kernel == "eigen-symmetric-96") {
    return {"spd-96.f64le", 96, 96, 9216, 0, 0, 0, 0};
  }
  throw std::runtime_error("unknown kernel: " + kernel);
}

std::uint64_t reverse_bytes(std::uint64_t value) {
  value = ((value & 0x00ff00ff00ff00ffULL) << 8) | ((value & 0xff00ff00ff00ff00ULL) >> 8);
  value = ((value & 0x0000ffff0000ffffULL) << 16) | ((value & 0xffff0000ffff0000ULL) >> 16);
  return (value << 32) | (value >> 32);
}

Fixture load_fixture(const std::filesystem::path& root, const FixtureSpec& spec,
                     const std::string& expected_sha256) {
  const auto path = root / spec.name;
  std::ifstream stream(path, std::ios::binary | std::ios::ate);
  if (!stream) throw std::runtime_error("unable to open fixture: " + path.string());
  const auto byte_count = static_cast<std::size_t>(stream.tellg());
  stream.seekg(0);
  std::vector<std::uint8_t> bytes(byte_count);
  if (!stream.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(byte_count))) {
    throw std::runtime_error("unable to read fixture: " + path.string());
  }

  Sha256 hasher;
  hasher.update(bytes);
  const auto actual_sha256 = hasher.finish();
  if (actual_sha256 != expected_sha256) {
    throw std::runtime_error("fixture hash mismatch: " + actual_sha256 + " != " + expected_sha256);
  }
  if (byte_count % sizeof(double) != 0) throw std::runtime_error("invalid f64 fixture size");

  std::vector<double> values(byte_count / sizeof(double));
  std::memcpy(values.data(), bytes.data(), byte_count);
  if constexpr (std::endian::native == std::endian::big) {
    for (auto& value : values) {
      auto bits = std::bit_cast<std::uint64_t>(value);
      value = std::bit_cast<double>(reverse_bytes(bits));
    }
  }
  const auto required_elements = std::max(
      spec.matrix_elements, std::max(spec.x_offset + spec.x_elements, spec.rhs_offset + spec.rhs_elements));
  if (values.size() != required_elements) throw std::runtime_error("unexpected fixture element count");

  using RowMajorMatrix = Eigen::Matrix<double, Eigen::Dynamic, Eigen::Dynamic, Eigen::RowMajor>;
  const Eigen::Map<const RowMajorMatrix> mapped_matrix(values.data(), spec.rows, spec.columns);
  Fixture fixture{mapped_matrix, VectorXd{}, VectorXd{}, actual_sha256};
  if (spec.x_elements != 0) {
    fixture.x_true = Eigen::Map<const VectorXd>(values.data() + spec.x_offset, spec.x_elements);
  }
  if (spec.rhs_elements != 0) {
    fixture.rhs = Eigen::Map<const VectorXd>(values.data() + spec.rhs_offset, spec.rhs_elements);
  }
  return fixture;
}

double relative(double value, double scale) {
  return value / std::max(scale, std::numeric_limits<double>::min());
}

template <typename Operation>
double warm_and_time(Operation&& operation) {
  operation();
  const auto start = Clock::now();
  operation();
  const auto end = Clock::now();
  return std::chrono::duration<double, std::milli>(end - start).count();
}

void print_metric(const char* name, double value) {
  std::cout << name << '=' << std::setprecision(17) << value << '\n';
}

void run(const std::string& kernel, const Fixture& fixture) {
  const auto& a = fixture.matrix;
  const auto a_norm = a.norm();
  double elapsed_ms = 0;
  double checksum = 0;

  if (kernel == "solve-general-96") {
    VectorXd solution;
    elapsed_ms = warm_and_time([&] {
      Eigen::PartialPivLU<MatrixXd> decomposition(a);
      solution = decomposition.solve(fixture.rhs);
    });
    print_metric("residual", relative((a * solution - fixture.rhs).norm(),
                                       a_norm * solution.norm() + fixture.rhs.norm()));
    print_metric("solution_error", relative((solution - fixture.x_true).norm(), fixture.x_true.norm()));
    checksum = solution.sum();
  } else if (kernel == "least-squares-tall-96x48") {
    VectorXd solution;
    elapsed_ms = warm_and_time([&] {
      Eigen::ColPivHouseholderQR<MatrixXd> decomposition(a);
      solution = decomposition.solve(fixture.rhs);
    });
    const VectorXd residual = a * solution - fixture.rhs;
    print_metric("residual", relative((a.transpose() * residual).norm(), a_norm * residual.norm()));
    print_metric("solution_error", relative((solution - fixture.x_true).norm(), fixture.x_true.norm()));
    checksum = solution.sum();
  } else if (kernel == "lu-general-96") {
    Eigen::PartialPivLU<MatrixXd> decomposition;
    elapsed_ms = warm_and_time([&] { decomposition.compute(a); });
    const MatrixXd packed = decomposition.matrixLU();
    MatrixXd lower = MatrixXd::Identity(a.rows(), a.cols());
    lower.template triangularView<Eigen::StrictlyLower>() = packed.template triangularView<Eigen::StrictlyLower>();
    const MatrixXd upper = packed.template triangularView<Eigen::Upper>();
    const MatrixXd permuted_lower = decomposition.permutationP().inverse() * lower;
    print_metric("reconstruction", relative((a - permuted_lower * upper).norm(), a_norm));
    checksum = permuted_lower.sum() + upper.sum();
  } else if (kernel == "qr-tall-96x48") {
    Eigen::HouseholderQR<MatrixXd> decomposition;
    const auto columns = a.cols();
    MatrixXd q;
    MatrixXd r;
    elapsed_ms = warm_and_time([&] {
      decomposition.compute(a);
      q = decomposition.householderQ() * MatrixXd::Identity(a.rows(), columns);
      r = decomposition.matrixQR().topLeftCorner(columns, columns)
              .template triangularView<Eigen::Upper>();
    });
    const MatrixXd identity = MatrixXd::Identity(columns, columns);
    print_metric("reconstruction", relative((a - q * r).norm(), a_norm));
    print_metric("orthogonality", relative((q.transpose() * q - identity).norm(), columns));
    checksum = q.sum() + r.sum();
  } else if (kernel == "cholesky-spd-96") {
    Eigen::LLT<MatrixXd> decomposition;
    elapsed_ms = warm_and_time([&] { decomposition.compute(a); });
    if (decomposition.info() != Eigen::Success) throw std::runtime_error("LLT failed");
    const MatrixXd lower = decomposition.matrixL();
    print_metric("reconstruction", relative((a - lower * lower.transpose()).norm(), a_norm));
    checksum = lower.sum();
  } else if (kernel == "svd-tall-96x48") {
    Eigen::BDCSVD<MatrixXd, Eigen::ComputeThinU | Eigen::ComputeThinV> decomposition;
    elapsed_ms = warm_and_time([&] { decomposition.compute(a); });
    if (decomposition.info() != Eigen::Success) throw std::runtime_error("BDCSVD failed");
    const auto& u = decomposition.matrixU();
    const auto& v = decomposition.matrixV();
    const auto& singular = decomposition.singularValues();
    const MatrixXd identity = MatrixXd::Identity(singular.size(), singular.size());
    print_metric("reconstruction",
                 relative((a - u * singular.asDiagonal() * v.transpose()).norm(), a_norm));
    print_metric("orthogonality",
                 std::max(relative((u.transpose() * u - identity).norm(), singular.size()),
                          relative((v.transpose() * v - identity).norm(), singular.size())));
    checksum = singular.sum();
  } else if (kernel == "eigen-symmetric-96") {
    Eigen::SelfAdjointEigenSolver<MatrixXd> decomposition;
    elapsed_ms = warm_and_time([&] { decomposition.compute(a, Eigen::ComputeEigenvectors); });
    if (decomposition.info() != Eigen::Success) throw std::runtime_error("eigensolver failed");
    const auto& values = decomposition.eigenvalues();
    const auto& vectors = decomposition.eigenvectors();
    const MatrixXd identity = MatrixXd::Identity(values.size(), values.size());
    print_metric("residual", relative((a * vectors - vectors * values.asDiagonal()).norm(), a_norm));
    print_metric("reconstruction",
                 relative((a - vectors * values.asDiagonal() * vectors.transpose()).norm(), a_norm));
    print_metric("orthogonality", relative((vectors.transpose() * vectors - identity).norm(), values.size()));
    checksum = values.sum();
  } else if (kernel == "eigen-general-96") {
    Eigen::EigenSolver<MatrixXd> decomposition;
    elapsed_ms = warm_and_time([&] { decomposition.compute(a, true); });
    if (decomposition.info() != Eigen::Success) throw std::runtime_error("general eigensolver failed");
    const auto values = decomposition.eigenvalues();
    const auto vectors = decomposition.eigenvectors();
    const auto complex_a = a.cast<std::complex<double>>();
    print_metric("residual",
                 relative((complex_a * vectors - vectors * values.asDiagonal()).norm(), a_norm));
    const auto eigenvalue_sum = values.sum();
    checksum = eigenvalue_sum.real() + eigenvalue_sum.imag();
  } else {
    throw std::runtime_error("unknown kernel: " + kernel);
  }

  print_metric("elapsed_ms", elapsed_ms);
  print_metric("checksum", checksum);
  std::cout << "input_sha256=" << fixture.sha256 << '\n';
  std::cout << "implementation=Eigen " << VKF_EIGEN_BENCHMARK_VERSION << " (single-thread)\n";
}

}  // namespace

int main(int argc, char** argv) {
  try {
    if (argc != 4) {
      std::cerr << "usage: vkf-linalg-eigen <kernel> <fixture-root> <expected-sha256>\n";
      return 2;
    }
    Eigen::setNbThreads(1);
    const std::string kernel = argv[1];
    const auto spec = fixture_spec(kernel);
    const auto fixture = load_fixture(argv[2], spec, argv[3]);
    run(kernel, fixture);
    return 0;
  } catch (const std::exception& error) {
    std::cerr << error.what() << '\n';
    return 1;
  }
}
