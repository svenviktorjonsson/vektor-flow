#pragma once

#include "vf/ast.hpp"
#include "vf/ui_runtime_contract.hpp"

#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <variant>
#include <vector>

namespace vf {

class RuntimeBuildError final : public std::runtime_error {
public:
    explicit RuntimeBuildError(std::string message);
};

class RuntimeLoadError final : public std::runtime_error {
public:
    explicit RuntimeLoadError(std::string message);
};

struct RuntimeNumberConstant {
    std::string text;
};

struct RuntimeBindingRef {
    std::string name;
};

struct RuntimeVectorValue;
struct RuntimeCallValue;
struct RuntimeAttributeValue;
struct RuntimeIndexValue;
struct RuntimeLooseDotValue;

using RuntimeExpr = std::variant<
    RuntimeNumberConstant,
    RuntimeBindingRef,
    std::shared_ptr<RuntimeVectorValue>,
    std::shared_ptr<RuntimeCallValue>,
    std::shared_ptr<RuntimeAttributeValue>,
    std::shared_ptr<RuntimeIndexValue>,
    std::shared_ptr<RuntimeLooseDotValue>>;

struct RuntimeVectorValue {
    std::vector<RuntimeExpr> elements;
};

struct RuntimeCallValue {
    RuntimeExpr func;
    std::vector<RuntimeExpr> args;
};

struct RuntimeAttributeValue {
    RuntimeExpr value;
    std::string name;
};

struct RuntimeIndexValue {
    RuntimeExpr value;
    int index = 0;
};

struct RuntimeLooseDotValue {
    RuntimeExpr value;
};

struct RuntimeBindStep {
    std::string target_name;
    std::optional<TypeExpr> type_expr;
    RuntimeExpr value;
};

struct RuntimeEmitStep {
    RuntimeExpr value;
};

using RuntimeStep = std::variant<RuntimeBindStep, RuntimeEmitStep>;

struct RuntimeProgramArtifact {
    std::string origin;
    UiRuntimePacketSnapshot initial_snapshot;
    std::vector<RuntimeStep> steps;
};

class RuntimeExecuteError final : public std::runtime_error {
public:
    explicit RuntimeExecuteError(std::string message);
};

JsonValue ToJsonValue(const RuntimeExpr& expr);
JsonValue ToJsonValue(const RuntimeStep& step);
JsonValue ToJsonValue(const RuntimeProgramArtifact& artifact);

RuntimeProgramArtifact build_runtime_program(const Module& module, const std::string& origin);
RuntimeProgramArtifact parse_runtime_program(const JsonValue& value);
RuntimeProgramArtifact parse_runtime_program(const std::string& text);
RuntimeProgramArtifact parse_runtime_program(const char* text);
std::string runtime_program_to_json(const RuntimeProgramArtifact& artifact, int indent = 2);
std::string execute_runtime_program(const RuntimeProgramArtifact& artifact);

}  // namespace vf
