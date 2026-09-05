#include "compiler/native/vkf_call_binding_plan.hpp"

#include <iostream>
#include <stdexcept>

namespace cb = vkf::call_binding;

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

int main(int argc, char** argv) {
    try {
        const std::string test = argc > 1 ? argv[1] : "";
        const std::vector<cb::Parameter> parameters{{"x", false}, {"y", false}, {"z", true}};
        if (test == "binding") {
            const auto positional = cb::plan_fixed_call(parameters, 3, {}, "weighted");
            require(positional.provided_mask == 7 && positional.defaulted_mask == 0, "positional masks");
            for (std::size_t index = 0; index < 3; ++index) {
                require(positional.parameters[index]->kind == cb::OperandKind::Positional, "positional kind");
                require(positional.parameters[index]->index == index, "positional index");
            }
            const auto named = cb::plan_fixed_call(parameters, 0, {"y", "x", "z"}, "weighted");
            require(named.parameters[0]->index == 1 && named.parameters[1]->index == 0 &&
                named.parameters[2]->index == 2, "named binding by parameter name");
            require(named.parameters[0]->kind == cb::OperandKind::Named, "named kind");
            const auto mixed = cb::plan_fixed_call(parameters, 1, {"z", "y"}, "weighted");
            require(mixed.parameters[0]->kind == cb::OperandKind::Positional &&
                mixed.parameters[1]->index == 1 && mixed.parameters[2]->index == 0, "mixed binding");
        } else if (test == "incremental") {
            auto plan = cb::plan_fixed_call(parameters, 1, {}, "weighted");
            require(cb::bind_named_argument(plan, parameters, "z", 0, "weighted") == 2, "incremental z slot");
            require(cb::bind_named_argument(plan, parameters, "y", 1, "weighted") == 1, "incremental y slot");
            require(plan.provided_mask == 7 && plan.defaulted_mask == 0 &&
                plan.missing_required_mask == 0, "incremental masks clear supplied holes");
            require(plan.parameters[1]->index == 1 && plan.parameters[2]->index == 0, "incremental operand references");
        } else if (test == "defaults") {
            const auto omitted = cb::plan_fixed_call(parameters, 2, {}, "weighted");
            require(omitted.provided_mask == 3 && omitted.defaulted_mask == 4 &&
                omitted.missing_required_mask == 0, "omitted default mask");
            require(!omitted.parameters[2], "default is not a caller-side expression");
            const auto supplied = cb::plan_fixed_call(parameters, 2, {"z"}, "weighted");
            require(supplied.provided_mask == 7 && supplied.defaulted_mask == 0, "provided skips default");
            const auto missing = cb::plan_fixed_call(parameters, 0, {"y"}, "weighted");
            require(missing.provided_mask == 2 && missing.defaulted_mask == 4 &&
                missing.missing_required_mask == 1, "required and defaulted holes differ");
        } else if (test == "diagnostics") {
            const auto fails = [&](std::size_t count, const std::vector<std::string>& names,
                                   const std::string& expected) {
                try { (void)cb::plan_fixed_call(parameters, count, names, "weighted"); }
                catch (const cb::Error& error) {
                    require(error.what() == expected, "exact native binding diagnostic changed");
                    return;
                }
                throw std::runtime_error("expected binding error");
            };
            fails(4, {}, "too many arguments for direct machine IR call weighted");
            fails(1, {"x"}, "multiple values for argument x");
            fails(0, {"y", "y"}, "multiple values for argument y");
            fails(0, {"first_bad", "second_bad"}, "unknown named argument first_bad for weighted");
            fails(0, {"second_bad", "first_bad"}, "unknown named argument second_bad for weighted");
            fails(1, {"x", "unknown"}, "multiple values for argument x");
            fails(1, {"unknown", "x"}, "unknown named argument unknown for weighted");
        } else if (test == "mask-boundaries") {
            require(cb::plan_fixed_call({}, 0, {}, "empty").provided_mask == 0, "zero-parameter mask");
            std::vector<cb::Parameter> maximum;
            for (unsigned index = 0; index < 32; ++index) maximum.push_back({"p" + std::to_string(index), true});
            const auto omitted = cb::plan_fixed_call(maximum, 0, {}, "maximum");
            require(omitted.defaulted_mask == 0xffffffffu && omitted.provided_mask == 0, "32 default bits");
            const auto supplied = cb::plan_fixed_call(maximum, 32, {}, "maximum");
            require(supplied.provided_mask == 0xffffffffu && supplied.defaulted_mask == 0, "32 supplied bits");
            maximum.push_back({"overflow", false});
            try { (void)cb::plan_fixed_call(maximum, 0, {}, "overflow"); }
            catch (const cb::Error& error) {
                require(std::string(error.what()) == "direct machine IR calls support at most 32 parameters", "32-parameter gate");
                std::cout << "ok\n";
                return 0;
            }
            throw std::runtime_error("32-parameter gate missing");
        } else throw std::runtime_error("unknown probe case");
        std::cout << "ok\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
