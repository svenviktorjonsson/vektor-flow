#include "native/VfOverlay/vf/json.hpp"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <process.h>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

class AotFailure : public std::runtime_error {
public:
    explicit AotFailure(std::string message) : std::runtime_error(std::move(message)) {}
};

const vf::JsonValue::Object& object_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_object()) throw AotFailure("expected object in " + context);
    return value.as_object();
}

const vf::JsonValue& field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto found = object.find(name);
    if (found == object.end()) throw AotFailure("missing " + name + " in " + context);
    return found->second;
}

std::string string_field(const vf::JsonValue::Object& object, const std::string& name, const std::string& context) {
    const auto& value = field(object, name, context);
    if (!value.is_string()) throw AotFailure("expected string " + name + " in " + context);
    return value.as_string();
}

const vf::JsonValue::Array& array_of(const vf::JsonValue& value, const std::string& context) {
    if (!value.is_array()) throw AotFailure("expected array in " + context);
    return value.as_array();
}

std::string read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw AotFailure("could not read " + path.string());
    std::ostringstream out;
    out << input.rdbuf();
    return out.str();
}

void write_file(const std::filesystem::path& path, const std::string& text) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw AotFailure("could not write " + path.string());
    output << text;
}

std::string hex_u64(std::uint64_t value) {
    constexpr char digits[] = "0123456789abcdef";
    std::string out(16, '0');
    for (int i = 15; i >= 0; --i) {
        out[static_cast<std::size_t>(i)] = digits[value & 0xf];
        value >>= 4;
    }
    return out;
}

std::string stable_hash(const std::string& text) {
    std::uint64_t hash = 1469598103934665603ull;
    for (unsigned char ch : text) {
        hash ^= ch;
        hash *= 1099511628211ull;
    }
    return hex_u64(hash);
}

std::string identifier(std::string name) {
    for (char& ch : name) {
        if (!std::isalnum(static_cast<unsigned char>(ch)) && ch != '_') ch = '_';
    }
    if (name.empty() || std::isdigit(static_cast<unsigned char>(name.front()))) name = "vf_" + name;
    return name;
}

std::string number_text(double value) {
    std::ostringstream out;
    out << std::setprecision(17) << value;
    return out.str();
}

struct Alias {
    std::string name;
    std::vector<std::string> fields;
};

class CppEmitter {
public:
    explicit CppEmitter(const vf::JsonValue& root) : module_(object_of(root, "typed module")) {
        if (string_field(module_, "kind", "typed module") != "typed_module") {
            throw AotFailure("unsupported typed IR root");
        }
        discover();
    }

    std::string emit() {
        std::ostringstream out;
        out << "#include <cmath>\n#include <cstdio>\n#include <vector>\n\n";
        for (const auto& [name, alias] : aliases_) {
            out << "struct " << identifier(name) << " {";
            for (const auto& member : alias.fields) out << " double " << identifier(member) << ";";
            out << " };\n";
        }
        out << "\n";
        for (const auto& [name, fn] : functions_) out << signature(fn) << ";\n";
        out << "\n";
        for (const auto& statement : array_of(field(module_, "body", "typed module"), "typed module body")) {
            const auto& object = object_of(statement, "top-level statement");
            if (string_field(object, "kind", "top-level statement") == "function") emit_function(out, object);
        }
        emit_main(out);
        return out.str();
    }

private:
    const vf::JsonValue::Object& module_;
    std::map<std::string, Alias> aliases_;
    std::map<std::string, const vf::JsonValue::Object*> functions_;
    std::set<std::string> variables_;

    void discover() {
        std::set<std::string> linked_declarations;
        for (const auto& statement : array_of(field(module_, "body", "typed module"), "typed module body")) {
            const auto& object = object_of(statement, "top-level statement");
            const auto kind = string_field(object, "kind", "top-level statement");
            if (kind != "function" && kind != "type_alias" && kind != "store_binding") continue;
            const auto name = object.find("name");
            if (name != object.end() && name->second.is_string()) {
                linked_declarations.insert(name->second.as_string());
            }
        }
        for (const auto& statement : array_of(field(module_, "body", "typed module"), "typed module body")) {
            const auto& object = object_of(statement, "top-level statement");
            const std::string kind = string_field(object, "kind", "top-level statement");
            if (kind == "function") {
                functions_[string_field(object, "name", "function")] = &object;
            } else if (kind == "type_alias") {
                const std::string name = string_field(object, "name", "type alias");
                const auto& annotation = object_of(field(object, "type_annotation", "type alias"), "type annotation");
                const std::string shape = string_field(annotation, "name", "type annotation");
                Alias alias{name, {}};
                std::size_t cursor = shape.find('(') + 1;
                while (cursor > 0 && cursor < shape.size()) {
                    const std::size_t colon = shape.find(':', cursor);
                    if (colon == std::string::npos) break;
                    alias.fields.push_back(shape.substr(cursor, colon - cursor));
                    const std::size_t comma = shape.find(',', colon);
                    const std::size_t close = shape.find(')', colon);
                    if (close == std::string::npos || (comma == std::string::npos || close < comma)) break;
                    cursor = comma + 1;
                }
                if (alias.fields.empty()) throw AotFailure("unsupported type alias " + shape);
                aliases_[name] = std::move(alias);
            } else if (kind == "module_import") {
                const auto& alias_value = field(object, "alias", "module_import");
                if (!alias_value.is_string() || alias_value.as_string().empty()) {
                    throw AotFailure("malformed linked module import alias");
                }
                const std::string prefix =
                    "__vkf_module_" + alias_value.as_string() + "__";
                const bool resolved = std::any_of(
                    linked_declarations.begin(), linked_declarations.end(),
                    [&](const auto& name) { return name.rfind(prefix, 0) == 0; });
                if (!resolved) {
                    throw AotFailure(
                        "unresolved linked module import " + alias_value.as_string());
                }
            } else if (kind != "expr_stmt") {
                throw AotFailure("unsupported top-level typed IR statement " + kind);
            }
        }
    }

    std::string cpp_type(const std::string& type) const {
        if (aliases_.count(type)) return identifier(type);
        if (type == "num" || type == "int" || type == "bit" || type == "any") return "double";
        if (type.rfind("list<", 0) == 0 || (!type.empty() && type.front() == '[')) return "std::vector<double>";
        if (type.rfind("record{", 0) == 0 && aliases_.size() == 1) return identifier(aliases_.begin()->first);
        throw AotFailure("unsupported AOT type " + type);
    }

    std::string signature(const vf::JsonValue::Object* fn) const {
        const std::string return_type = cpp_type(string_field(*fn, "return_type", "function"));
        std::string out = return_type + " " + identifier(string_field(*fn, "name", "function")) + "(";
        const auto& params = array_of(field(*fn, "params", "function"), "function params");
        for (std::size_t i = 0; i < params.size(); ++i) {
            if (i) out += ", ";
            const auto& param = object_of(params[i], "param");
            out += cpp_type(string_field(param, "type", "param")) + " " + identifier(string_field(param, "name", "param"));
        }
        return out + ")";
    }

    std::string infer_record_type(const vf::JsonValue::Object& object, const std::string& expected) const {
        if (aliases_.count(expected)) return identifier(expected);
        const auto& fields = array_of(field(object, "fields", "record"), "record fields");
        for (const auto& [name, alias] : aliases_) {
            if (alias.fields.size() != fields.size()) continue;
            bool matches = true;
            for (std::size_t i = 0; i < fields.size(); ++i) {
                if (string_field(object_of(fields[i], "field"), "name", "field") != alias.fields[i]) matches = false;
            }
            if (matches) return identifier(name);
        }
        throw AotFailure("record literal has no declared AOT type");
    }

    std::string expression(const vf::JsonValue& value, const std::string& expected = "") const {
        const auto& object = object_of(value, "expression");
        const std::string kind = string_field(object, "kind", "expression");
        if (kind == "const") {
            const auto& raw = field(object, "value", "const");
            if (raw.is_number()) return number_text(raw.as_number());
            if (raw.is_boolean()) return raw.as_boolean() ? "1.0" : "0.0";
            throw AotFailure("AOT const must be numeric");
        }
        if (kind == "load") return identifier(string_field(object, "name", "load"));
        if (kind == "field_access") {
            return "(" + expression(field(object, "object", "field access")) + ")." + identifier(string_field(object, "field", "field access"));
        }
        if (kind == "dotted_index") {
            const auto& indices = array_of(field(object, "indices", "dotted index"), "dotted indices");
            if (indices.size() != 1) throw AotFailure("AOT dotted index requires one index");
            return "(" + expression(field(object, "base", "dotted index")) + ")[static_cast<std::size_t>("
                + expression(indices.front()) + ")]";
        }
        if (kind == "list") {
            std::string out = "std::vector<double>{";
            const auto& items = array_of(field(object, "items", "list"), "list items");
            for (std::size_t i = 0; i < items.size(); ++i) {
                if (i) out += ", ";
                out += expression(items[i]);
            }
            return out + "}";
        }
        if (kind == "record") {
            const std::string type = infer_record_type(object, expected);
            std::string out = type + "{";
            const auto& fields = array_of(field(object, "fields", "record"), "record fields");
            for (std::size_t i = 0; i < fields.size(); ++i) {
                if (i) out += ", ";
                out += expression(field(object_of(fields[i], "field"), "value", "field"));
            }
            return out + "}";
        }
        if (kind == "binary_op") {
            static const std::map<std::string, std::string> ops{
                {"PLUS", "+"}, {"MINUS", "-"}, {"STAR", "*"}, {"SLASH", "/"},
                {"LT", "<"}, {"LE", "<="}, {"GT", ">"}, {"GE", ">="}, {"EQ", "=="}, {"NE", "!="},
            };
            const std::string op = string_field(object, "op", "binary op");
            const auto found = ops.find(op);
            if (found == ops.end()) throw AotFailure("unsupported AOT operator " + op);
            return "(" + expression(field(object, "left", "binary op")) + " " + found->second + " "
                + expression(field(object, "right", "binary op")) + ")";
        }
        if (kind == "call") {
            const auto& callee = object_of(field(object, "callee", "call"), "callee");
            if (string_field(callee, "kind", "callee") != "load") throw AotFailure("unsupported AOT call target");
            std::string out = identifier(string_field(callee, "name", "callee")) + "(";
            const auto& args = array_of(field(object, "args", "call"), "call args");
            for (std::size_t i = 0; i < args.size(); ++i) {
                if (i) out += ", ";
                out += expression(args[i]);
            }
            return out + ")";
        }
        throw AotFailure("unsupported AOT expression " + kind);
    }

    void emit_block(std::ostringstream& out, const vf::JsonValue& block_value, int indent, const std::string& return_type) {
        const auto& block = object_of(block_value, "block");
        const auto& body = array_of(field(block, "body", "block"), "block body");
        for (std::size_t i = 0; i < body.size(); ++i) {
            const auto& statement = object_of(body[i], "statement");
            const std::string kind = string_field(statement, "kind", "statement");
            const std::string pad(static_cast<std::size_t>(indent), ' ');
            if (kind == "store_binding") {
                const std::string name = identifier(string_field(statement, "name", "store"));
                const std::string type = string_field(statement, "type", "store");
                const bool declared = variables_.count(name) != 0;
                if (!declared) variables_.insert(name);
                out << pad << (declared ? "" : cpp_type(type) + " ") << name << " = "
                    << expression(field(statement, "value", "store"), type) << ";\n";
            } else if (kind == "expr_stmt") {
                const bool last = i + 1 == body.size();
                if (last) out << pad << "return " << expression(field(statement, "expr", "expr stmt"), return_type) << ";\n";
                else out << pad << "(void)(" << expression(field(statement, "expr", "expr stmt")) << ");\n";
            } else if (kind == "return") {
                out << pad << "return " << expression(field(statement, "value", "return"), return_type) << ";\n";
            } else if (kind == "if_stmt") {
                const auto& loop = field(statement, "loop", "if stmt");
                const bool is_loop = loop.is_boolean() && loop.as_boolean();
                out << pad << (is_loop ? "while" : "if") << " (" << expression(field(statement, "condition", "if stmt")) << ") {\n";
                emit_block(out, field(statement, "body", "if stmt"), indent + 4, return_type);
                out << pad << "}\n";
            } else {
                throw AotFailure("unsupported AOT statement " + kind);
            }
        }
    }

    void emit_function(std::ostringstream& out, const vf::JsonValue::Object& fn) {
        variables_.clear();
        for (const auto& value : array_of(field(fn, "params", "function"), "params")) {
            variables_.insert(identifier(string_field(object_of(value, "param"), "name", "param")));
        }
        const std::string return_type = string_field(fn, "return_type", "function");
        out << signature(&fn) << " {\n";
        emit_block(out, field(fn, "body", "function"), 4, return_type);
        out << "}\n\n";
    }

    void emit_main(std::ostringstream& out) const {
        const auto& body = array_of(field(module_, "body", "typed module"), "typed module body");
        const vf::JsonValue::Object* print = nullptr;
        for (const auto& statement : body) {
            const auto& object = object_of(statement, "top-level statement");
            if (string_field(object, "kind", "top-level statement") != "expr_stmt") continue;
            const auto& call = object_of(field(object, "expr", "expr stmt"), "top-level expression");
            if (string_field(call, "kind", "top-level expression") == "call") print = &call;
        }
        if (!print) throw AotFailure("AOT program requires one top-level print");
        const auto& args = array_of(field(*print, "args", "print"), "print args");
        if (args.size() != 1) throw AotFailure("AOT print requires one argument");
        out << "int main() {\n"
            << "    const double value = " << expression(args.front()) << ";\n"
            << "    if (std::isfinite(value) && std::floor(value) == value && std::abs(value) < 9007199254740992.0) std::printf(\"%.0f\\n\", value);\n"
            << "    else std::printf(\"%.17g\\n\", value);\n"
            << "    return 0;\n}\n";
    }
};

struct Args {
    std::filesystem::path source;
    std::filesystem::path typed_ir;
    std::string compiler = "clang++";
};

Args parse_args(int argc, char** argv) {
    Args args;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--source" && i + 1 < argc) args.source = argv[++i];
        else if (arg == "--typed-ir" && i + 1 < argc) args.typed_ir = argv[++i];
        else if (arg == "--compiler" && i + 1 < argc) args.compiler = argv[++i];
        else if (arg == "--dependency" && i + 1 < argc) ++i;
        else if (arg == "--deferred") {}
        else throw AotFailure("usage: vkf_cpp_aot_artifact --source file --typed-ir file [--compiler clang++]");
    }
    if (args.source.empty() || args.typed_ir.empty()) throw AotFailure("source and typed IR are required");
    return args;
}

int compile_cpp(const std::string& compiler, const std::filesystem::path& cpp, const std::filesystem::path& exe) {
    const auto response_path = cpp.parent_path() / "clang.rsp";
    write_file(
        response_path,
        "-std=c++17\n-O1\n-fuse-ld=lld\n\"" + cpp.generic_string() + "\"\n-o\n\"" + exe.generic_string() + "\"\n"
    );
    const auto response_arg = std::filesystem::relative(response_path, std::filesystem::current_path()).generic_string();
    std::vector<std::string> storage{
        compiler, "@" + response_arg,
    };
    std::vector<const char*> argv;
    for (const auto& arg : storage) argv.push_back(arg.c_str());
    argv.push_back(nullptr);
    return static_cast<int>(_spawnvp(_P_WAIT, compiler.c_str(), argv.data()));
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Args args = parse_args(argc, argv);
        const std::string source_text = read_file(args.source);
        const std::string ir_text = read_file(args.typed_ir);
        const vf::JsonValue ir = vf::parse_json(ir_text);
        const std::string stem = args.source.stem().string().empty() ? "program" : args.source.stem().string();
        const auto build_dir = std::filesystem::absolute(args.source).parent_path() / ".vkfbuild" / stem;
        const auto cpp_path = build_dir / (stem + ".cpp");
        const auto exe_path = build_dir / (stem + ".exe");
        const auto manifest_path = build_dir / "aot-manifest.json";
        std::filesystem::create_directories(build_dir);
        write_file(cpp_path, CppEmitter(ir).emit());
        if (compile_cpp(args.compiler, cpp_path, exe_path) != 0 || !std::filesystem::is_regular_file(exe_path)) {
            throw AotFailure("native C++ compiler failed");
        }
        vf::JsonValue::Object manifest;
        manifest["artifact_path"] = vf::JsonValue(exe_path.string());
        manifest["backend"] = vf::JsonValue("cpp-aot");
        manifest["source_sha256"] = vf::JsonValue(stable_hash(source_text));
        manifest["typed_ir_sha256"] = vf::JsonValue(stable_hash(ir_text));
        manifest["status"] = vf::JsonValue("compiled");
        write_file(manifest_path, vf::json_stringify(vf::JsonValue(manifest), 2) + "\n");
        vf::JsonValue::Object result;
        result["artifact_path"] = vf::JsonValue(exe_path.string());
        result["manifest_path"] = vf::JsonValue(manifest_path.string());
        result["status"] = vf::JsonValue("compiled");
        std::cout << vf::json_stringify(vf::JsonValue(std::move(result)), -1) << "\n";
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << "<cpp-aot>:1:1: " << exc.what() << "\n";
        return 1;
    }
}
