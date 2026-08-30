#pragma once

#include <cstddef>
#include <cstdint>
#include <istream>
#include <string>
#include <vector>

namespace vkf::data::detail {

// Private native tracer seam. This is not a VKF data.load contract.
struct CsvScanLimits {
    std::size_t max_index_bytes;
    std::size_t max_header_bytes;
    std::size_t max_cell_bytes;
};

struct CsvRowByteRange {
    std::uint64_t begin;
    std::uint64_t end;
};

enum class CsvHeaderMode {
    present,
    absent,
};

enum class CsvNumericCellError {
    none,
    empty,
    invalid,
    out_of_range,
};

enum class CsvInferredColumnType {
    integer,
    number,
    string,
};

struct CsvNumericCellResult {
    double value = 0.0;
    CsvNumericCellError error = CsvNumericCellError::none;

    bool has_value() const noexcept {
        return error == CsvNumericCellError::none;
    }
};

class CsvDemandSourceScanner {
public:
    static CsvDemandSourceScanner scan(
        std::istream& source,
        CsvScanLimits limits,
        CsvHeaderMode header_mode = CsvHeaderMode::present);

    const std::vector<std::string>& raw_column_names() const noexcept;
    std::size_t column_count() const noexcept;
    std::size_t row_count() const noexcept;
    CsvRowByteRange row_range(std::size_t row) const;
    CsvRowByteRange row_range(std::istream& source, std::size_t row) const;
    std::size_t retained_bytes() const noexcept;
    std::size_t checkpoint_count() const noexcept;
    std::size_t checkpoint_stride() const noexcept;

    std::string demand_cell(
        std::istream& source,
        std::size_t row,
        std::size_t column) const;

    CsvNumericCellResult demand_numeric_cell(
        std::istream& source,
        std::size_t row,
        std::size_t column) const;

    CsvInferredColumnType infer_column_type(
        std::istream& source,
        std::size_t column) const;

private:
    explicit CsvDemandSourceScanner(CsvScanLimits limits);
    void append_row(CsvRowByteRange range);
    void thin_checkpoints();

    CsvScanLimits limits_;
    std::vector<std::string> raw_column_names_;
    std::size_t column_count_ = 0u;
    std::vector<CsvRowByteRange> checkpoints_;
    std::size_t row_count_ = 0u;
    std::size_t checkpoint_stride_ = 1u;
    CsvRowByteRange last_row_range_{};
};

}  // namespace vkf::data::detail
