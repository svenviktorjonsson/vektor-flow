#include "compiler/native/vkf_wasm_bytecode_lowering.hpp"
#include "compiler/native/vkf_wasm_vm_emitter.hpp"
#include "native/VfOverlay/vf/json.hpp"

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

class ArtifactError : public std::runtime_error {
public:
    explicit ArtifactError(const std::string& message)
        : std::runtime_error(message) {}
};

struct Arguments {
    std::filesystem::path typed_ir;
    std::filesystem::path wasm;
    std::filesystem::path manifest;
    std::string entry;
    bool prune_to_entry = false;
};

Arguments parse_arguments(int argc, char** argv) {
    Arguments arguments;
    for (int index = 1; index < argc; ++index) {
        const std::string argument = argv[index];
        if (argument == "--typed-ir" && index + 1 < argc) {
            arguments.typed_ir = argv[++index];
        } else if (argument == "--wasm" && index + 1 < argc) {
            arguments.wasm = argv[++index];
        } else if (argument == "--manifest" && index + 1 < argc) {
            arguments.manifest = argv[++index];
        } else if (argument == "--entry" && index + 1 < argc) {
            arguments.entry = argv[++index];
        } else if (argument == "--prune-to-entry") {
            arguments.prune_to_entry = true;
        } else {
            throw ArtifactError(
                "usage: vkf_symbolic_kernel_artifact "
                "--typed-ir <file> --wasm <file> --manifest <file> "
                "[--entry <function>]"
            );
        }
    }
    if (arguments.typed_ir.empty()
        || arguments.wasm.empty()
        || arguments.manifest.empty()) {
        throw ArtifactError(
            "typed IR, WASM, and manifest paths are required"
        );
    }
    if (arguments.prune_to_entry && arguments.entry.empty()) {
        throw ArtifactError("--prune-to-entry requires --entry");
    }
    return arguments;
}

std::string read_text(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw ArtifactError("cannot read " + path.string());
    }
    return {
        std::istreambuf_iterator<char>(input),
        std::istreambuf_iterator<char>(),
    };
}

void ensure_parent(const std::filesystem::path& path) {
    const auto parent = path.parent_path();
    if (!parent.empty()) {
        std::filesystem::create_directories(parent);
    }
}

void write_bytes(
    const std::filesystem::path& path,
    const std::vector<std::uint8_t>& bytes
) {
    ensure_parent(path);
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output) {
        throw ArtifactError("cannot write " + path.string());
    }
    output.write(
        reinterpret_cast<const char*>(bytes.data()),
        static_cast<std::streamsize>(bytes.size())
    );
}

void write_text(
    const std::filesystem::path& path,
    const std::string& text
) {
    ensure_parent(path);
    std::ofstream output(path, std::ios::binary | std::ios::trunc);
    if (!output) {
        throw ArtifactError("cannot write " + path.string());
    }
    output << text;
}

std::uint32_t function_index(
    const vkf::wasm::TypedModule& module,
    const std::string& name
) {
    for (std::size_t index = 0; index < module.functions.size(); ++index) {
        if (module.functions[index].name == name) {
            return static_cast<std::uint32_t>(index);
        }
    }
    throw ArtifactError("unknown entry function " + name);
}

vf::JsonValue manifest_value(
    const vkf::wasm::TypedModule& typed_module,
    const vkf::wasm::bytecode::Module& bytecode,
    const vkf::wasm::vm::EmittedModule& emitted,
    const std::filesystem::path& wasm_path
) {
    vf::JsonValue::Object functions;
    for (std::size_t index = 0; index < typed_module.functions.size(); ++index) {
        const auto& declaration = typed_module.functions[index];
        const auto& function = bytecode.functions[index];
        vf::JsonValue::Object item;
        item["index"] = vf::JsonValue(static_cast<double>(index));
        item["parameters"] = vf::JsonValue(
            static_cast<double>(function.parameter_count)
        );
        item["resultType"] = vf::JsonValue(
            static_cast<double>(static_cast<std::uint8_t>(
                function.return_type
            ))
        );
        functions[declaration.name] = vf::JsonValue(std::move(item));
    }

    vf::JsonValue::Object memory;
    memory["bytecodePointer"] = vf::JsonValue(
        static_cast<double>(emitted.layout.bytecode_ptr)
    );
    memory["bytecodeLength"] = vf::JsonValue(
        static_cast<double>(emitted.layout.bytecode_len)
    );
    memory["argumentsPointer"] = vf::JsonValue(
        static_cast<double>(emitted.layout.arguments_ptr)
    );
    memory["argumentsCapacity"] = vf::JsonValue(
        static_cast<double>(emitted.layout.arguments_capacity)
    );
    memory["resultsPointer"] = vf::JsonValue(
        static_cast<double>(emitted.layout.results_ptr)
    );
    memory["resultsCapacity"] = vf::JsonValue(
        static_cast<double>(emitted.layout.results_capacity)
    );

    vf::JsonValue::Object manifest;
    manifest["schema"] = vf::JsonValue("vektor-flow.symbolic-kernel");
    manifest["version"] = vf::JsonValue(1.0);
    manifest["wasm"] = vf::JsonValue(wasm_path.filename().generic_string());
    manifest["functions"] = vf::JsonValue(std::move(functions));
    manifest["memory"] = vf::JsonValue(std::move(memory));
    return vf::JsonValue(std::move(manifest));
}

void collect_direct_calls(
    const vf::JsonValue& value,
    std::set<std::string>& calls
) {
    if (value.is_array()) {
        for (const auto& item : value.as_array()) collect_direct_calls(item, calls);
        return;
    }
    if (!value.is_object()) return;
    const auto& object = value.as_object();
    const auto kind = object.find("kind");
    if (kind != object.end() && kind->second.is_string() &&
        kind->second.as_string() == "call") {
        const auto callee = object.find("callee");
        if (callee != object.end() && callee->second.is_object()) {
            const auto& callee_object = callee->second.as_object();
            const auto callee_kind = callee_object.find("kind");
            const auto name = callee_object.find("name");
            if (callee_kind != callee_object.end() && callee_kind->second.is_string() &&
                callee_kind->second.as_string() == "load" &&
                name != callee_object.end() && name->second.is_string()) {
                calls.insert(name->second.as_string());
            }
        }
    }
    for (const auto& entry : object) collect_direct_calls(entry.second, calls);
}

vf::JsonValue executable_typed_module(
    const vf::JsonValue& typed_ir,
    const std::string& root_function = ""
) {
    const auto& root = typed_ir.as_object();
    auto filtered = root;
    std::map<std::string, std::vector<const vf::JsonValue*>> functions;
    for (const auto& item : root.at("body").as_array()) {
        if (!item.is_object()) continue;
        const auto& declaration = item.as_object();
        const auto kind = declaration.find("kind");
        const auto name = declaration.find("name");
        if (kind != declaration.end() && kind->second.is_string() &&
            kind->second.as_string() == "function" &&
            name != declaration.end() && name->second.is_string()) {
            functions[name->second.as_string()].push_back(&item);
        }
    }
    std::set<std::string> reachable;
    if (!root_function.empty()) {
        std::vector<std::string> pending{root_function};
        while (!pending.empty()) {
            const std::string name = std::move(pending.back());
            pending.pop_back();
            if (!reachable.insert(name).second) continue;
            const auto found = functions.find(name);
            if (found == functions.end()) continue;
            std::set<std::string> calls;
            for (const auto* declaration : found->second) {
                collect_direct_calls(*declaration, calls);
            }
            for (const auto& called : calls) {
                if (functions.find(called) != functions.end() &&
                    reachable.find(called) == reachable.end()) {
                    pending.push_back(called);
                }
            }
        }
    }
    vf::JsonValue::Array body;
    for (const auto& item : root.at("body").as_array()) {
        const auto& declaration = item.as_object();
        const auto kind = declaration.find("kind");
        if (kind != declaration.end() && kind->second.is_string() &&
            kind->second.as_string() == "module_import") {
            continue;
        }
        if (!root_function.empty() && kind != declaration.end() &&
            kind->second.is_string()) {
            if (kind->second.as_string() == "expr_stmt") continue;
            if (kind->second.as_string() == "function") {
                const auto name = declaration.find("name");
                if (name == declaration.end() || !name->second.is_string() ||
                    reachable.find(name->second.as_string()) == reachable.end()) {
                    continue;
                }
            }
        }
        body.push_back(item);
    }
    filtered["body"] = vf::JsonValue(std::move(body));
    return vf::JsonValue(std::move(filtered));
}

}  // namespace

int main(int argc, char** argv) {
    try {
        const Arguments arguments = parse_arguments(argc, argv);
        const vf::JsonValue typed_ir =
            vf::parse_json(read_text(arguments.typed_ir));
        const auto typed_module = vkf::wasm::parse_typed_module(
            executable_typed_module(
                typed_ir,
                arguments.prune_to_entry ? arguments.entry : ""
            )
        );
        auto bytecode =
            vkf::wasm::bytecode::lower_typed_module_to_bytecode(typed_module);
        if (!arguments.entry.empty()) {
            bytecode.entry_function =
                function_index(typed_module, arguments.entry);
        }
        vkf::wasm::bytecode::validate(bytecode);
        vkf::wasm::vm::EmitterOptions emitter_options;
        emitter_options.arena_capacity = 64U * 1024U * 1024U;
        const auto emitted = vkf::wasm::vm::emit(
            bytecode,
            emitter_options
        );
        write_bytes(arguments.wasm, emitted.wasm);
        write_text(
            arguments.manifest,
            vf::json_stringify(
                manifest_value(
                    typed_module,
                    bytecode,
                    emitted,
                    arguments.wasm
                ),
                2
            ) + "\n"
        );
        std::cout << arguments.wasm.string();
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what();
        return 2;
    }
}
