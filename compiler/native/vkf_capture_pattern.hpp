#pragma once

#include <array>
#include <cctype>
#include <cstdint>
#include <limits>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace vkf::capture {

class PatternFailure : public std::runtime_error {
public:
    explicit PatternFailure(std::string message) : std::runtime_error(std::move(message)) {}
};

struct ByteSet {
    std::array<std::uint64_t, 4> words{};

    void add(unsigned byte) { words[byte >> 6] |= std::uint64_t{1} << (byte & 63u); }
    void remove(unsigned byte) { words[byte >> 6] &= ~(std::uint64_t{1} << (byte & 63u)); }
    bool contains(unsigned byte) const {
        return (words[byte >> 6] & (std::uint64_t{1} << (byte & 63u))) != 0;
    }
    void invert() {
        for (auto& word : words) word = ~word;
    }
};

enum class OpKind : std::uint8_t { BeginCapture, EndCapture, Atom };

struct Op {
    OpKind kind = OpKind::Atom;
    std::uint32_t capture = 0;
    ByteSet bytes;
    std::uint32_t minimum = 1;
    std::uint32_t maximum = 1;
};

struct Pattern {
    bool anchor_start = false;
    bool anchor_end = false;
    bool synthetic_full_capture = false;
    std::vector<std::string> group_names;
    std::vector<Op> ops;
};

namespace detail {

inline ByteSet one_byte(unsigned byte) {
    ByteSet out;
    out.add(byte);
    return out;
}

inline ByteSet digits() {
    ByteSet out;
    for (unsigned byte = '0'; byte <= '9'; ++byte) out.add(byte);
    return out;
}

inline ByteSet word() {
    ByteSet out = digits();
    for (unsigned byte = 'a'; byte <= 'z'; ++byte) out.add(byte);
    for (unsigned byte = 'A'; byte <= 'Z'; ++byte) out.add(byte);
    out.add('_');
    return out;
}

inline ByteSet whitespace() {
    ByteSet out;
    for (const unsigned byte : {' ', '\t', '\n', '\r', '\f', '\v'}) out.add(byte);
    return out;
}

class Parser {
public:
    explicit Parser(std::string_view source) : source_(source) {}

    Pattern parse() {
        if (!source_.empty() && source_.front() == '^') {
            pattern_.anchor_start = true;
            position_ = 1;
        }
        parse_sequence(false);
        if (position_ != source_.size()) fail("unexpected closing group");
        if (!pattern_.ops.empty() && pattern_.ops.back().kind == OpKind::Atom &&
            pattern_.ops.back().minimum == 1 && pattern_.ops.back().maximum == 1 &&
            last_was_unescaped_dollar_) {
            pattern_.ops.pop_back();
            pattern_.anchor_end = true;
        }
        if (pattern_.group_names.empty()) {
            pattern_.synthetic_full_capture = true;
            pattern_.group_names.push_back("_");
        }
        return pattern_;
    }

private:
    std::string_view source_;
    std::size_t position_ = 0;
    Pattern pattern_;
    bool last_was_unescaped_dollar_ = false;

    [[noreturn]] void fail(const std::string& message) const {
        throw PatternFailure(
            "capture pattern at byte " + std::to_string(position_) + ": " + message);
    }

    unsigned take() {
        if (position_ >= source_.size()) fail("unexpected end");
        return static_cast<unsigned char>(source_[position_++]);
    }

    std::uint32_t decimal() {
        if (position_ >= source_.size() || !std::isdigit(
                static_cast<unsigned char>(source_[position_]))) {
            fail("expected decimal repetition count");
        }
        std::uint64_t value = 0;
        while (position_ < source_.size() && std::isdigit(
                static_cast<unsigned char>(source_[position_]))) {
            value = value * 10u + static_cast<unsigned>(source_[position_++] - '0');
            if (value > std::numeric_limits<std::uint32_t>::max()) {
                fail("repetition count is too large");
            }
        }
        return static_cast<std::uint32_t>(value);
    }

    ByteSet escaped_atom() {
        const unsigned escaped = take();
        if (escaped == 'd') return digits();
        if (escaped == 'w') return word();
        if (escaped == 's') return whitespace();
        if (escaped == 'D') { auto set = digits(); set.invert(); return set; }
        if (escaped == 'W') { auto set = word(); set.invert(); return set; }
        if (escaped == 'S') { auto set = whitespace(); set.invert(); return set; }
        if (escaped == 'n') return one_byte('\n');
        if (escaped == 'r') return one_byte('\r');
        if (escaped == 't') return one_byte('\t');
        return one_byte(escaped);
    }

    ByteSet character_class() {
        ByteSet set;
        bool negate = false;
        if (position_ < source_.size() && source_[position_] == '^') {
            negate = true;
            ++position_;
        }
        bool have_item = false;
        while (position_ < source_.size() && source_[position_] != ']') {
            unsigned first = take();
            if (first == '\\') {
                const auto escaped = escaped_atom();
                for (unsigned byte = 0; byte < 256; ++byte) {
                    if (escaped.contains(byte)) set.add(byte);
                }
                have_item = true;
                continue;
            }
            if (position_ + 1 < source_.size() && source_[position_] == '-' &&
                source_[position_ + 1] != ']') {
                ++position_;
                unsigned last = take();
                if (last == '\\') {
                    const auto escaped = escaped_atom();
                    unsigned only = 256;
                    for (unsigned byte = 0; byte < 256; ++byte) {
                        if (!escaped.contains(byte)) continue;
                        if (only != 256) fail("class range endpoint must be one byte");
                        only = byte;
                    }
                    last = only;
                }
                if (last < first) fail("descending character-class range");
                for (unsigned byte = first; byte <= last; ++byte) set.add(byte);
            } else {
                set.add(first);
            }
            have_item = true;
        }
        if (position_ >= source_.size() || take() != ']') fail("unterminated character class");
        if (!have_item) fail("empty character class");
        if (negate) set.invert();
        return set;
    }

    void apply_quantifier(Op& atom) {
        if (position_ >= source_.size()) return;
        const char marker = source_[position_];
        if (marker == '?') {
            ++position_; atom.minimum = 0; atom.maximum = 1;
        } else if (marker == '*') {
            ++position_; atom.minimum = 0; atom.maximum = std::numeric_limits<std::uint32_t>::max();
        } else if (marker == '+') {
            ++position_; atom.minimum = 1; atom.maximum = std::numeric_limits<std::uint32_t>::max();
        } else if (marker == '{') {
            ++position_;
            atom.minimum = decimal();
            atom.maximum = atom.minimum;
            if (position_ < source_.size() && source_[position_] == ',') {
                ++position_;
                atom.maximum = position_ < source_.size() && source_[position_] != '}'
                    ? decimal() : std::numeric_limits<std::uint32_t>::max();
            }
            if (position_ >= source_.size() || take() != '}') fail("unterminated repetition");
            if (atom.maximum < atom.minimum) fail("repetition maximum precedes minimum");
        }
    }

    void parse_group() {
        bool capture = true;
        std::string name;
        if (position_ < source_.size() && source_[position_] == '?') {
            ++position_;
            if (position_ < source_.size() && source_[position_] == ':') {
                ++position_;
                capture = false;
            } else if (position_ + 2 < source_.size() && source_[position_] == 'P' &&
                source_[position_ + 1] == '<') {
                position_ += 2;
                const auto begin = position_;
                while (position_ < source_.size() && source_[position_] != '>') ++position_;
                if (position_ >= source_.size()) fail("unterminated named capture");
                name = std::string(source_.substr(begin, position_ - begin));
                ++position_;
                if (name.empty() || !(std::isalpha(static_cast<unsigned char>(name.front())) ||
                    name.front() == '_')) fail("invalid capture name");
                for (const char byte : name) {
                    if (!(std::isalnum(static_cast<unsigned char>(byte)) || byte == '_')) {
                        fail("invalid capture name");
                    }
                }
            } else {
                fail("only (?:...) and (?P<name>...) group prefixes are portable");
            }
        }
        std::uint32_t id = 0;
        if (capture) {
            id = static_cast<std::uint32_t>(pattern_.group_names.size());
            if (name.empty()) name = "m" + std::to_string(id);
            for (const auto& existing : pattern_.group_names) {
                if (existing == name) fail("duplicate capture name " + name);
            }
            pattern_.group_names.push_back(name);
            Op begin;
            begin.kind = OpKind::BeginCapture;
            begin.capture = id;
            pattern_.ops.push_back(begin);
        }
        parse_sequence(true);
        if (capture) {
            Op end;
            end.kind = OpKind::EndCapture;
            end.capture = id;
            pattern_.ops.push_back(end);
        }
        if (position_ < source_.size() &&
            (source_[position_] == '?' || source_[position_] == '*' ||
             source_[position_] == '+' || source_[position_] == '{')) {
            fail("quantified groups are not supported by the native regex grammar");
        }
    }

    void parse_sequence(bool in_group) {
        while (position_ < source_.size()) {
            if (source_[position_] == ')') {
                if (!in_group) fail("unexpected closing group");
                ++position_;
                return;
            }
            if (source_[position_] == '(') {
                ++position_;
                last_was_unescaped_dollar_ = false;
                parse_group();
                continue;
            }
            if (source_[position_] == '|') {
                fail("alternation is not supported by the native regex grammar");
            }
            if (source_[position_] == '?' || source_[position_] == '*' ||
                source_[position_] == '+' || source_[position_] == '{') {
                fail("quantifier has no preceding atom");
            }
            Op atom;
            atom.kind = OpKind::Atom;
            const unsigned byte = take();
            last_was_unescaped_dollar_ = byte == '$' && position_ == source_.size() && !in_group;
            if (byte == '\\') atom.bytes = escaped_atom();
            else if (byte == '.') { atom.bytes.invert(); atom.bytes.remove('\n'); }
            else if (byte == '[') atom.bytes = character_class();
            else atom.bytes = one_byte(byte);
            apply_quantifier(atom);
            if (position_ < source_.size() &&
                (source_[position_] == '?' || source_[position_] == '*' ||
                 source_[position_] == '+' || source_[position_] == '{')) {
                fail("an atom may have only one quantifier");
            }
            pattern_.ops.push_back(atom);
        }
        if (in_group) fail("unterminated group");
    }
};

}  // namespace detail

inline Pattern parse(std::string_view source) { return detail::Parser(source).parse(); }

}  // namespace vkf::capture
