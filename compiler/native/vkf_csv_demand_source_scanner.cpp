#include "compiler/native/vkf_csv_demand_source_scanner.hpp"

#include <algorithm>
#include <charconv>
#include <limits>
#include <optional>
#include <stdexcept>
#include <utility>

namespace vkf::data::detail {
namespace {

enum class FieldState {
    start,
    unquoted,
    quoted,
    after_quote,
};

struct ParsedRecord {
    CsvRowByteRange range{};
    std::vector<std::string> fields;
    std::size_t field_count = 0u;
};

std::uint64_t stream_offset(std::istream& source) {
    const auto position = source.tellg();
    if (position == std::istream::pos_type(-1)) {
        throw std::runtime_error("CSV source is not seekable");
    }
    const auto offset = static_cast<std::streamoff>(position);
    if (offset < 0) {
        throw std::runtime_error("CSV source position is negative");
    }
    return static_cast<std::uint64_t>(offset);
}

void append_captured(
    std::string& field,
    char byte,
    std::size_t& captured_bytes,
    std::size_t max_captured_bytes) {
    if (captured_bytes >= max_captured_bytes) {
        throw std::runtime_error("CSV header exceeds the private scanner limit");
    }
    field.push_back(byte);
    ++captured_bytes;
}

std::optional<ParsedRecord> read_record(
    std::istream& source,
    bool capture_fields,
    std::size_t max_captured_bytes) {
    if (source.eof()) {
        return std::nullopt;
    }
    const auto begin = stream_offset(source);
    std::uint64_t cursor = begin;
    FieldState state = FieldState::start;
    bool consumed_any = false;
    std::size_t captured_bytes = 0;
    ParsedRecord record;
    record.range.begin = begin;
    std::string field;

    const auto finish_field = [&]() {
        ++record.field_count;
        if (capture_fields) {
            record.fields.push_back(std::move(field));
            field.clear();
        }
        state = FieldState::start;
    };

    while (true) {
        const int next = source.get();
        if (next == std::char_traits<char>::eof()) {
            if (!consumed_any) {
                return std::nullopt;
            }
            if (state == FieldState::quoted) {
                throw std::runtime_error("unterminated quoted CSV field");
            }
            finish_field();
            record.range.end = cursor;
            return record;
        }
        consumed_any = true;
        ++cursor;
        if (capture_fields && cursor - begin > max_captured_bytes) {
            throw std::runtime_error("CSV header exceeds the private scanner limit");
        }
        const char byte = static_cast<char>(next);

        if (state == FieldState::quoted) {
            if (byte == '"') {
                state = FieldState::after_quote;
            } else if (capture_fields) {
                append_captured(field, byte, captured_bytes, max_captured_bytes);
            }
            continue;
        }

        if (state == FieldState::after_quote) {
            if (byte == '"') {
                if (capture_fields) {
                    append_captured(field, byte, captured_bytes, max_captured_bytes);
                }
                state = FieldState::quoted;
                continue;
            }
            if (byte == ',') {
                finish_field();
                continue;
            }
            if (byte != '\r' && byte != '\n') {
                throw std::runtime_error("unexpected byte after quoted CSV field");
            }
        } else if (byte == ',' && state != FieldState::quoted) {
            finish_field();
            continue;
        } else if (byte == '"') {
            if (state != FieldState::start) {
                throw std::runtime_error("quote inside unquoted CSV field");
            }
            state = FieldState::quoted;
            continue;
        } else if (byte != '\r' && byte != '\n') {
            state = FieldState::unquoted;
            if (capture_fields) {
                append_captured(field, byte, captured_bytes, max_captured_bytes);
            }
            continue;
        }

        finish_field();
        record.range.end = cursor - 1u;
        if (byte == '\r' && source.peek() == '\n') {
            static_cast<void>(source.get());
            ++cursor;
        }
        return record;
    }
}

void append_demanded(
    std::string& output,
    char byte,
    std::size_t limit) {
    if (output.size() >= limit) {
        throw std::runtime_error("demanded CSV cell exceeds the private scanner limit");
    }
    output.push_back(byte);
}

std::string read_cell(
    std::istream& source,
    CsvRowByteRange range,
    std::size_t target_column,
    std::size_t max_cell_bytes) {
    source.clear();
    source.seekg(static_cast<std::streamoff>(range.begin), std::ios::beg);
    if (!source) {
        throw std::runtime_error("could not seek to indexed CSV row");
    }

    FieldState state = FieldState::start;
    std::size_t column = 0;
    std::string demanded;
    std::uint64_t cursor = range.begin;
    while (cursor < range.end) {
        const int next = source.get();
        if (next == std::char_traits<char>::eof()) {
            throw std::runtime_error("indexed CSV row ended early");
        }
        ++cursor;
        const char byte = static_cast<char>(next);

        if (state == FieldState::quoted) {
            if (byte == '"') {
                state = FieldState::after_quote;
            } else if (column == target_column) {
                append_demanded(demanded, byte, max_cell_bytes);
            }
            continue;
        }
        if (state == FieldState::after_quote) {
            if (byte == '"') {
                if (column == target_column) {
                    append_demanded(demanded, byte, max_cell_bytes);
                }
                state = FieldState::quoted;
                continue;
            }
            if (byte != ',') {
                throw std::runtime_error("unexpected byte after quoted CSV field");
            }
            ++column;
            state = FieldState::start;
            continue;
        }
        if (byte == ',') {
            ++column;
            state = FieldState::start;
            continue;
        }
        if (byte == '"') {
            if (state != FieldState::start) {
                throw std::runtime_error("quote inside unquoted CSV field");
            }
            state = FieldState::quoted;
            continue;
        }
        state = FieldState::unquoted;
        if (column == target_column) {
            append_demanded(demanded, byte, max_cell_bytes);
        }
    }
    if (state == FieldState::quoted) {
        throw std::runtime_error("unterminated quoted CSV field");
    }
    if (column < target_column) {
        throw std::out_of_range("CSV row does not contain the demanded column");
    }
    return demanded;
}

}  // namespace

CsvDemandSourceScanner::CsvDemandSourceScanner(CsvScanLimits limits)
    : limits_(limits) {
    if (limits_.max_index_bytes < sizeof(CsvRowByteRange) ||
        limits_.max_header_bytes == 0u ||
        limits_.max_cell_bytes == 0u) {
        throw std::invalid_argument("CSV scanner limits must be positive");
    }
}

CsvDemandSourceScanner CsvDemandSourceScanner::scan(
    std::istream& source,
    CsvScanLimits limits,
    CsvHeaderMode header_mode) {
    CsvDemandSourceScanner scanner(limits);
    const bool capture_header = header_mode == CsvHeaderMode::present;
    const auto first = read_record(
        source,
        capture_header,
        capture_header ? limits.max_header_bytes : 0u);
    if (!first) {
        if (capture_header) {
            throw std::runtime_error("CSV source has no header");
        }
        return scanner;
    }
    scanner.column_count_ = first->field_count;
    if (capture_header) {
        scanner.raw_column_names_ = first->fields;
    } else {
        scanner.append_row(first->range);
    }

    while (const auto row = read_record(source, false, 0u)) {
        scanner.append_row(row->range);
    }
    return scanner;
}

const std::vector<std::string>&
CsvDemandSourceScanner::raw_column_names() const noexcept {
    return raw_column_names_;
}

std::size_t CsvDemandSourceScanner::column_count() const noexcept {
    return column_count_;
}

std::size_t CsvDemandSourceScanner::row_count() const noexcept {
    return row_count_;
}

CsvRowByteRange CsvDemandSourceScanner::row_range(std::size_t row) const {
    if (row >= row_count_) {
        throw std::out_of_range("CSV row index is out of range");
    }
    if (row + 1u == row_count_) {
        return last_row_range_;
    }
    if (row % checkpoint_stride_ != 0u) {
        throw std::runtime_error(
            "CSV row range requires the source after sparse indexing");
    }
    return checkpoints_.at(row / checkpoint_stride_);
}

CsvRowByteRange CsvDemandSourceScanner::row_range(
    std::istream& source,
    std::size_t row) const {
    if (row >= row_count_) {
        throw std::out_of_range("CSV row index is out of range");
    }
    if (row + 1u == row_count_) {
        return last_row_range_;
    }

    if (checkpoints_.empty()) {
        throw std::runtime_error("CSV sparse index has no initial checkpoint");
    }
    const auto checkpoint_index = std::min(
        row / checkpoint_stride_,
        checkpoints_.size() - 1u);
    const auto checkpoint_row = checkpoint_index * checkpoint_stride_;
    const auto checkpoint = checkpoints_[checkpoint_index];

    source.clear();
    source.seekg(
        static_cast<std::streamoff>(checkpoint.begin),
        std::ios::beg);
    if (!source) {
        throw std::runtime_error("could not seek to sparse CSV checkpoint");
    }
    CsvRowByteRange range = checkpoint;
    for (std::size_t current = checkpoint_row; current <= row; ++current) {
        const auto record = read_record(source, false, 0u);
        if (!record) {
            throw std::runtime_error("CSV source ended before the demanded row");
        }
        range = record->range;
    }
    return range;
}

std::size_t CsvDemandSourceScanner::retained_bytes() const noexcept {
    std::size_t bytes = checkpoints_.capacity() * sizeof(CsvRowByteRange) +
        raw_column_names_.capacity() * sizeof(std::string);
    for (const auto& name : raw_column_names_) {
        bytes += name.capacity();
    }
    return bytes;
}

std::size_t CsvDemandSourceScanner::checkpoint_count() const noexcept {
    return checkpoints_.size();
}

std::size_t CsvDemandSourceScanner::checkpoint_stride() const noexcept {
    return checkpoint_stride_;
}

std::string CsvDemandSourceScanner::demand_cell(
    std::istream& source,
    std::size_t row,
    std::size_t column) const {
    if (column >= column_count_) {
        throw std::out_of_range("CSV column index is out of range");
    }
    const auto range = row_range(source, row);
    return read_cell(source, range, column, limits_.max_cell_bytes);
}

CsvNumericCellResult CsvDemandSourceScanner::demand_numeric_cell(
    std::istream& source,
    std::size_t row,
    std::size_t column) const {
    const auto cell = demand_cell(source, row, column);
    if (cell.empty()) {
        return {0.0, CsvNumericCellError::empty};
    }

    double value = 0.0;
    const auto parsed = std::from_chars(
        cell.data(),
        cell.data() + cell.size(),
        value,
        std::chars_format::general);
    if (parsed.ec == std::errc::result_out_of_range) {
        return {0.0, CsvNumericCellError::out_of_range};
    }
    if (parsed.ec != std::errc{} || parsed.ptr != cell.data() + cell.size()) {
        return {0.0, CsvNumericCellError::invalid};
    }
    return {value, CsvNumericCellError::none};
}

CsvInferredColumnType CsvDemandSourceScanner::infer_column_type(
    std::istream& source,
    std::size_t column) const {
    if (column >= column_count_) {
        throw std::out_of_range("CSV column index is out of range");
    }
    auto inferred = CsvInferredColumnType::integer;
    if (row_count_ == 0u) {
        return inferred;
    }

    const auto first = row_range(source, 0u);
    source.clear();
    source.seekg(static_cast<std::streamoff>(first.begin), std::ios::beg);
    if (!source) {
        throw std::runtime_error("could not seek to first CSV data row");
    }
    for (std::size_t row = 0u; row < row_count_; ++row) {
        const auto record = read_record(source, false, 0u);
        if (!record) {
            throw std::runtime_error("CSV source ended during column inference");
        }
        const auto next_record = source.tellg();
        const auto cell = read_cell(
            source,
            record->range,
            column,
            limits_.max_cell_bytes);
        std::int64_t integer_value = 0;
        const auto integer = std::from_chars(
            cell.data(),
            cell.data() + cell.size(),
            integer_value);
        const bool is_integer = !cell.empty() &&
            integer.ec == std::errc{} &&
            integer.ptr == cell.data() + cell.size();
        if (!is_integer) {
            double number_value = 0.0;
            const auto number = std::from_chars(
                cell.data(),
                cell.data() + cell.size(),
                number_value,
                std::chars_format::general);
            if (!cell.empty() && number.ec == std::errc{} &&
                number.ptr == cell.data() + cell.size()) {
                inferred = CsvInferredColumnType::number;
            } else {
                return CsvInferredColumnType::string;
            }
        }
        if (row + 1u < row_count_) {
            if (next_record == std::istream::pos_type(-1)) {
                throw std::runtime_error(
                    "CSV source ended before the next inferred row");
            }
            source.clear();
            source.seekg(next_record);
            if (!source) {
                throw std::runtime_error(
                    "could not advance during CSV column inference");
            }
        }
    }
    return inferred;
}

void CsvDemandSourceScanner::append_row(CsvRowByteRange range) {
    const auto row = row_count_;
    ++row_count_;
    last_row_range_ = range;

    const auto max_checkpoints =
        limits_.max_index_bytes / sizeof(CsvRowByteRange);
    while (row % checkpoint_stride_ == 0u &&
           checkpoints_.size() >= max_checkpoints) {
        thin_checkpoints();
    }
    if (row % checkpoint_stride_ != 0u) {
        return;
    }
    if (checkpoints_.size() == checkpoints_.capacity()) {
        const auto desired = checkpoints_.capacity() == 0u
            ? std::min(max_checkpoints, std::size_t{64u})
            : checkpoints_.capacity() > max_checkpoints / 2u
                ? max_checkpoints
                : checkpoints_.capacity() * 2u;
        checkpoints_.reserve(std::min(max_checkpoints, desired));
    }
    checkpoints_.push_back(range);
}

void CsvDemandSourceScanner::thin_checkpoints() {
    if (checkpoint_stride_ >
        std::numeric_limits<std::size_t>::max() / 2u) {
        checkpoint_stride_ = std::numeric_limits<std::size_t>::max();
        checkpoints_.erase(
            checkpoints_.begin() + 1,
            checkpoints_.end());
        return;
    }
    checkpoint_stride_ *= 2u;

    auto output = checkpoints_.begin();
    for (std::size_t index = 0u; index < checkpoints_.size(); index += 2u) {
        *output = checkpoints_[index];
        ++output;
    }
    checkpoints_.erase(output, checkpoints_.end());
}

}  // namespace vkf::data::detail
