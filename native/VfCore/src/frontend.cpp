#include "vf/frontend.hpp"

#include "vf/ast.hpp"
#include "vf/lexer.hpp"
#include "vf/parser.hpp"
#include "vf/runtime.hpp"

namespace vf {

FrontendResult lex_source(const std::string& source, const std::string& origin) {
    FrontendResult result;
    try {
        const std::vector<Token> tokens = tokenize_source(source, origin);
        result.ok = true;
        result.payload = token_stream_to_json(tokens);
        return result;
    } catch (const LexError& ex) {
        result.ok = false;
        const SourceLocation& at = ex.location();
        result.diagnostics.push_back(
            Diagnostic{"lex", std::string(ex.what()) + " at " + at.file + ":" +
                std::to_string(at.line) + ":" + std::to_string(at.column)});
        return result;
    }
}

FrontendResult parse_source(const std::string& source, const std::string& origin) {
    FrontendResult result;
    try {
        const std::vector<Token> tokens = tokenize_source(source, origin);
        const Module module = parse_tokens(tokens);
        result.ok = true;
        result.payload = ast_to_json(module);
        return result;
    } catch (const LexError& ex) {
        result.ok = false;
        const SourceLocation& at = ex.location();
        result.diagnostics.push_back(
            Diagnostic{"parse", std::string(ex.what()) + " at " + at.file + ":" +
                std::to_string(at.line) + ":" + std::to_string(at.column)});
        return result;
    } catch (const ParseError& ex) {
        result.ok = false;
        const SourceLocation& at = ex.location();
        result.diagnostics.push_back(
            Diagnostic{"parse", std::string(ex.what()) + " at " + at.file + ":" +
                std::to_string(at.line) + ":" + std::to_string(at.column)});
        return result;
    }
}

FrontendResult artifact_source(const std::string& source, const std::string& origin) {
    FrontendResult result;
    try {
        const std::vector<Token> tokens = tokenize_source(source, origin);
        const Module module = parse_tokens(tokens);
        const RuntimeProgramArtifact artifact = build_runtime_program(module, origin);
        result.ok = true;
        result.payload = runtime_program_to_json(artifact);
        return result;
    } catch (const LexError& ex) {
        result.ok = false;
        const SourceLocation& at = ex.location();
        result.diagnostics.push_back(
            Diagnostic{"run", std::string(ex.what()) + " at " + at.file + ":" +
                std::to_string(at.line) + ":" + std::to_string(at.column)});
        return result;
    } catch (const ParseError& ex) {
        result.ok = false;
        const SourceLocation& at = ex.location();
        result.diagnostics.push_back(
            Diagnostic{"run", std::string(ex.what()) + " at " + at.file + ":" +
                std::to_string(at.line) + ":" + std::to_string(at.column)});
        return result;
    } catch (const RuntimeBuildError& ex) {
        result.ok = false;
        result.diagnostics.push_back(Diagnostic{"run", ex.what()});
        return result;
    }
}

FrontendResult run_source(const std::string& source, const std::string& origin) {
    FrontendResult result;
    try {
        const std::vector<Token> tokens = tokenize_source(source, origin);
        const Module module = parse_tokens(tokens);
        const RuntimeProgramArtifact artifact = build_runtime_program(module, origin);
        result.ok = true;
        result.payload = execute_runtime_program(artifact);
        return result;
    } catch (const LexError& ex) {
        result.ok = false;
        const SourceLocation& at = ex.location();
        result.diagnostics.push_back(
            Diagnostic{"run", std::string(ex.what()) + " at " + at.file + ":" +
                std::to_string(at.line) + ":" + std::to_string(at.column)});
        return result;
    } catch (const ParseError& ex) {
        result.ok = false;
        const SourceLocation& at = ex.location();
        result.diagnostics.push_back(
            Diagnostic{"run", std::string(ex.what()) + " at " + at.file + ":" +
                std::to_string(at.line) + ":" + std::to_string(at.column)});
        return result;
    } catch (const RuntimeBuildError& ex) {
        result.ok = false;
        result.diagnostics.push_back(Diagnostic{"run", ex.what()});
        return result;
    } catch (const RuntimeExecuteError& ex) {
        result.ok = false;
        result.diagnostics.push_back(Diagnostic{"run", ex.what()});
        return result;
    }
}

}  // namespace vf
