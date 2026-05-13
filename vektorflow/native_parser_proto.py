"""Tiny native parser/codegen prototype for the first native-core slices.

This module is intentionally narrow: it embeds a compiled C++ tool that parses
the exact grammar shapes used by ``examples/native_core/hello_native.vkf``,
``examples/native_core/vectors_native.vkf``, ``examples/native_core/numeric_native.vkf``,
``examples/native_core/named_record_native.vkf``,
``examples/native_core/named_record_collections_native.vkf``, and
``examples/native_core/named_record_scene_native.vkf``,
``examples/native_core/named_record_scene_helpers_native.vkf`` and emits standalone C++
for those slices.

The goal is not to pretend we have a full native parser already. The goal is to
replace one real frontend step with a genuinely native-backed parser/codegen
path we can grow from.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
import subprocess
import tempfile

from .cpp_backend import CppEmitError, compile_cpp_source


def _native_parser_proto_cpp_source() -> str:
    return r"""
#include <cctype>
#include <algorithm>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

struct Token {
    std::string kind;
    std::string text;
};

struct EmitExpressionProgram {
    std::vector<Token> expression_tokens;
    std::string cpp_expression;
};

struct InlineFunctionDefinition {
    std::string function_name;
    std::vector<std::string> param_names;
    std::vector<std::pair<std::string, std::string>> local_bindings;
    std::string return_cpp_expression;
    bool has_inline_signature_body = false;
};

struct InlineFunctionProgram {
    std::vector<InlineFunctionDefinition> functions;
    std::vector<std::pair<std::string, std::string>> top_level_bindings;
    std::string emit_cpp_expression;
};

struct HelloProgram {
    std::string function_name;
    std::string param_name;
    double multiplier = 0.0;
    double call_arg = 0.0;
};

struct VectorBinding {
    std::string name;
    std::vector<double> values;
};

struct VectorProgram {
    VectorBinding left_binding;
    VectorBinding right_binding;
    std::string function_name;
    std::string left_param_name;
    std::string right_param_name;
    std::size_t extent = 0;
    double scale = 0.0;
    std::string emit_left_name;
    std::string emit_right_name;
};

struct NumericBinding {
    std::string name;
    std::vector<double> values;
};

struct NumericProgram {
    NumericBinding xs_binding;
    NumericBinding ys_binding;
};

struct NamedRecordProgram {
    std::string type_name;
    std::string first_field_name;
    std::string second_field_name;
    std::string move_function_name;
    std::string param_name;
    std::string delta_x_name;
    std::string delta_y_name;
    std::string base_name;
    double base_first_value = 0.0;
    double base_second_value = 0.0;
    std::string shifted_name;
    double shift_x_value = 0.0;
    double shift_y_value = 0.0;
};

struct NestedNamedRecordProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string box_type_name;
    std::string box_origin_field_name;
    std::string box_size_field_name;
    std::string translate_function_name;
    std::string param_name;
    std::string delta_x_name;
    std::string delta_y_name;
    std::string base_name;
    double base_origin_first_value = 0.0;
    double base_origin_second_value = 0.0;
    double base_size_first_value = 0.0;
    double base_size_second_value = 0.0;
    std::string moved_name;
    double shift_x_value = 0.0;
    double shift_y_value = 0.0;
};

struct NamedRecordCollectionsProgram {
    std::string type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string function_name;
    std::string param_name;
    std::string extra_name;
    std::string delta_name;
    std::string base_name;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string moved_name;
    double moved_vector_first_value = 0.0;
    double moved_vector_second_value = 0.0;
    double moved_multiset_key = 0.0;
    long long moved_multiset_count = 0;
};

struct RecordsProgram {
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string function_name;
    std::string param_name;
    std::string extra_name;
    std::string delta_name;
    std::string base_name;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_first_key = 0.0;
    long long base_multiset_first_count = 0;
    double base_multiset_second_key = 0.0;
    long long base_multiset_second_count = 0;
    double base_total_value = 0.0;
    double extra_first_value = 0.0;
    double extra_second_value = 0.0;
    double delta_first_key = 0.0;
    long long delta_first_count = 0;
    double delta_second_key = 0.0;
    long long delta_second_count = 0;
};

struct NamedRecordSceneProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string function_name;
    std::string scene_param_name;
    std::string shift_param_name;
    std::string extra_param_name;
    std::string delta_param_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string moved_name;
    double moved_vector_first_value = 0.0;
    double moved_vector_second_value = 0.0;
    double moved_multiset_key = 0.0;
    long long moved_multiset_count = 0;
};

struct NamedRecordSceneChainProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string function_name;
    std::string scene_param_name;
    std::string shift_param_name;
    std::string extra_param_name;
    std::string delta_param_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string first_name;
    double first_vector_first_value = 0.0;
    double first_vector_second_value = 0.0;
    double first_multiset_key = 0.0;
    long long first_multiset_count = 0;
    std::string second_name;
    double second_vector_first_value = 0.0;
    double second_vector_second_value = 0.0;
    double second_multiset_key = 0.0;
    long long second_multiset_count = 0;
};

struct NamedRecordSceneHelpersProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string shift_anchor_function_name;
    std::string shift_anchor_param_name;
    std::string shift_anchor_shift_name;
    std::string bump_state_function_name;
    std::string bump_state_param_name;
    std::string bump_state_extra_name;
    std::string bump_state_delta_name;
    std::string step_function_name;
    std::string scene_param_name;
    std::string shift_param_name;
    std::string extra_param_name;
    std::string delta_param_name;
    std::string next_anchor_name;
    std::string next_state_name;
    std::string out_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string moved_name;
    double moved_vector_first_value = 0.0;
    double moved_vector_second_value = 0.0;
    double moved_multiset_key = 0.0;
    long long moved_multiset_count = 0;
};

struct NamedRecordSceneHandoffProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string shift_anchor_function_name;
    std::string shift_anchor_param_name;
    std::string shift_anchor_shift_name;
    std::string bump_state_function_name;
    std::string bump_state_param_name;
    std::string bump_state_extra_name;
    std::string bump_state_delta_name;
    std::string step_function_name;
    std::string scene_param_name;
    std::string shift_param_name;
    std::string extra_param_name;
    std::string delta_param_name;
    std::string next_anchor_name;
    std::string next_state_name;
    std::string out_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string first_name;
    double first_vector_first_value = 0.0;
    double first_vector_second_value = 0.0;
    double first_multiset_key = 0.0;
    long long first_multiset_count = 0;
    std::string second_name;
    double second_vector_first_value = 0.0;
    double second_vector_second_value = 0.0;
    double second_multiset_key = 0.0;
    long long second_multiset_count = 0;
};

struct NamedRecordSceneComposeProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string shift_anchor_function_name;
    std::string shift_anchor_param_name;
    std::string shift_anchor_shift_name;
    std::string bump_state_function_name;
    std::string bump_state_param_name;
    std::string bump_state_extra_name;
    std::string bump_state_delta_name;
    std::string step_function_name;
    std::string scene_param_name;
    std::string shift_param_name;
    std::string extra_param_name;
    std::string delta_param_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string moved_anchor_name;
    std::string staged_name;
    double staged_vector_first_value = 0.0;
    double staged_vector_second_value = 0.0;
    double staged_multiset_key = 0.0;
    long long staged_multiset_count = 0;
    std::string moved_name;
};

struct NamedRecordScenePatchProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string shift_anchor_function_name;
    std::string shift_anchor_param_name;
    std::string shift_anchor_shift_name;
    std::string bump_state_function_name;
    std::string bump_state_param_name;
    std::string bump_state_extra_name;
    std::string bump_state_delta_name;
    std::string move_anchor_function_name;
    std::string move_anchor_scene_name;
    std::string move_anchor_shift_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string shifted_name;
    std::string patched_name;
    double patched_vector_first_value = 0.0;
    double patched_vector_second_value = 0.0;
    double patched_multiset_key = 0.0;
    long long patched_multiset_count = 0;
    std::string moved_name;
};

struct NamedRecordSceneSplitProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string step_function_name;
    std::string scene_param_name;
    std::string shift_param_name;
    std::string extra_param_name;
    std::string delta_param_name;
    std::string shift_anchor_function_name;
    std::string shift_anchor_param_name;
    std::string shift_anchor_shift_name;
    std::string bump_state_function_name;
    std::string bump_state_param_name;
    std::string bump_state_extra_name;
    std::string bump_state_delta_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string staged_name;
    double staged_vector_first_value = 0.0;
    double staged_vector_second_value = 0.0;
    double staged_multiset_key = 0.0;
    long long staged_multiset_count = 0;
    std::string moved_state_name;
    std::string final_anchor_name;
    std::string final_state_name;
    double final_vector_first_value = 0.0;
    double final_vector_second_value = 0.0;
    double final_multiset_key = 0.0;
    long long final_multiset_count = 0;
    std::string moved_name;
};

struct NamedRecordSceneRebuildProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string step_function_name;
    std::string scene_param_name;
    std::string shift_param_name;
    std::string extra_param_name;
    std::string delta_param_name;
    std::string shift_anchor_function_name;
    std::string shift_anchor_param_name;
    std::string shift_anchor_shift_name;
    std::string bump_state_function_name;
    std::string bump_state_param_name;
    std::string bump_state_extra_name;
    std::string bump_state_delta_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string staged_name;
    double staged_vector_first_value = 0.0;
    double staged_vector_second_value = 0.0;
    double staged_multiset_key = 0.0;
    long long staged_multiset_count = 0;
    std::string moved_anchor_name;
    std::string moved_state_name;
    std::string moved_name;
    std::string emit_anchor_field_name;
    double moved_vector_first_value = 0.0;
    double moved_vector_second_value = 0.0;
    double moved_multiset_key = 0.0;
    long long moved_multiset_count = 0;
};

struct NamedRecordSceneCheckpointProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string step_function_name;
    std::string scene_param_name;
    std::string shift_param_name;
    std::string extra_param_name;
    std::string delta_param_name;
    std::string shift_anchor_function_name;
    std::string shift_anchor_param_name;
    std::string shift_anchor_shift_name;
    std::string bump_state_function_name;
    std::string bump_state_param_name;
    std::string bump_state_extra_name;
    std::string bump_state_delta_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string staged_name;
    std::string checkpoint_name;
    std::string moved_name;
    std::string emit_anchor_field_name;
};

struct NamedRecordSceneSpliceProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string shift_anchor_function_name;
    std::string shift_anchor_param_name;
    std::string shift_anchor_shift_name;
    std::string bump_state_function_name;
    std::string bump_state_param_name;
    std::string bump_state_extra_name;
    std::string bump_state_delta_name;
    std::string move_anchor_function_name;
    std::string move_anchor_scene_name;
    std::string move_anchor_shift_name;
    std::string fill_state_function_name;
    std::string fill_state_scene_name;
    std::string fill_state_extra_name;
    std::string fill_state_delta_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string shifted_name;
    std::string filled_name;
    std::string final_anchor_name;
    std::string final_state_name;
    double final_vector_first_value = 0.0;
    double final_vector_second_value = 0.0;
    double final_multiset_key = 0.0;
    long long final_multiset_count = 0;
    std::string moved_name;
};

struct NamedRecordSceneFanoutProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string shift_anchor_function_name;
    std::string shift_anchor_param_name;
    std::string shift_anchor_shift_name;
    std::string bump_state_function_name;
    std::string bump_state_param_name;
    std::string bump_state_extra_name;
    std::string bump_state_delta_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string first_anchor_name;
    std::string first_state_name;
    std::string first_name;
    double first_vector_first_value = 0.0;
    double first_vector_second_value = 0.0;
    double first_multiset_key = 0.0;
    long long first_multiset_count = 0;
    std::string second_anchor_name;
    std::string second_state_name;
    std::string second_name;
    double second_vector_first_value = 0.0;
    double second_vector_second_value = 0.0;
    double second_multiset_key = 0.0;
    long long second_multiset_count = 0;
};

struct NamedRecordSceneOverlayProgram {
    std::string point_type_name;
    std::string point_first_field_name;
    std::string point_second_field_name;
    std::string state_type_name;
    std::string vector_field_name;
    std::string multiset_field_name;
    std::string total_field_name;
    std::string scene_type_name;
    std::string anchor_field_name;
    std::string state_field_name;
    std::string shift_anchor_function_name;
    std::string shift_anchor_param_name;
    std::string shift_anchor_shift_name;
    std::string bump_state_function_name;
    std::string bump_state_param_name;
    std::string bump_state_extra_name;
    std::string bump_state_delta_name;
    std::string move_anchor_function_name;
    std::string move_anchor_scene_name;
    std::string move_anchor_shift_name;
    std::string fill_state_function_name;
    std::string fill_state_scene_name;
    std::string fill_state_extra_name;
    std::string fill_state_delta_name;
    std::string base_name;
    double base_anchor_first_value = 0.0;
    double base_anchor_second_value = 0.0;
    double base_vector_first_value = 0.0;
    double base_vector_second_value = 0.0;
    double base_multiset_key = 0.0;
    long long base_multiset_count = 0;
    double base_total_value = 0.0;
    std::string shift_name;
    double shift_first_value = 0.0;
    double shift_second_value = 0.0;
    std::string shifted_name;
    std::string filled_name;
    double filled_vector_first_value = 0.0;
    double filled_vector_second_value = 0.0;
    double filled_multiset_key = 0.0;
    long long filled_multiset_count = 0;
    std::string moved_name;
};

static std::string emit_hello_cpp(const HelloProgram& program);
static std::string emit_vector_cpp(const VectorProgram& program);
static std::string emit_numeric_cpp(const NumericProgram& program);
static std::string emit_named_record_cpp(const NamedRecordProgram& program);
static std::string emit_nested_named_record_cpp(const NestedNamedRecordProgram& program);
static std::string emit_named_record_collections_cpp(const NamedRecordCollectionsProgram& program);
static std::string emit_records_cpp(const RecordsProgram& program);
static std::string emit_named_record_scene_cpp(const NamedRecordSceneProgram& program);
static std::string emit_named_record_scene_chain_cpp(const NamedRecordSceneChainProgram& program);
static std::string emit_named_record_scene_helpers_cpp(const NamedRecordSceneHelpersProgram& program);
static std::string emit_named_record_scene_handoff_cpp(const NamedRecordSceneHandoffProgram& program);
static std::string emit_named_record_scene_compose_cpp(const NamedRecordSceneComposeProgram& program);
static std::string emit_named_record_scene_patch_cpp(const NamedRecordScenePatchProgram& program);
static std::string emit_named_record_scene_split_cpp(const NamedRecordSceneSplitProgram& program);
static std::string emit_named_record_scene_rebuild_cpp(const NamedRecordSceneRebuildProgram& program);
static std::string emit_named_record_scene_checkpoint_cpp(const NamedRecordSceneCheckpointProgram& program);
static std::string emit_named_record_scene_splice_cpp(const NamedRecordSceneSpliceProgram& program);
static std::string emit_named_record_scene_fanout_cpp(const NamedRecordSceneFanoutProgram& program);
static std::string emit_named_record_scene_overlay_cpp(const NamedRecordSceneOverlayProgram& program);
static std::string emit_expression_cpp(const EmitExpressionProgram& program);
static std::string emit_inline_function_cpp(const InlineFunctionProgram& program);

static std::string trim(const std::string& s) {
    std::size_t start = 0;
    while (start < s.size() && std::isspace(static_cast<unsigned char>(s[start]))) {
        start += 1;
    }
    std::size_t end = s.size();
    while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1]))) {
        end -= 1;
    }
    return s.substr(start, end - start);
}

static std::string normalize_newlines(const std::string& source) {
    std::string out;
    out.reserve(source.size());
    for (std::size_t i = 0; i < source.size(); ++i) {
        char ch = source[i];
        if (ch == '\r') {
            if (i + 1 < source.size() && source[i + 1] == '\n') {
                continue;
            }
            out.push_back('\n');
            continue;
        }
        out.push_back(ch);
    }
    return out;
}

static std::vector<std::string> logical_lines(const std::string& source) {
    std::vector<std::string> lines;
    std::istringstream in(source);
    std::string line;
    while (std::getline(in, line)) {
        std::string stripped = trim(line);
        if (stripped.empty()) {
            continue;
        }
        if (!stripped.empty() && stripped[0] == '#') {
            continue;
        }
        lines.push_back(line);
    }
    return lines;
}

static bool is_ident_start(char ch) {
    return std::isalpha(static_cast<unsigned char>(ch)) || ch == '_';
}

static bool is_ident_continue(char ch) {
    return std::isalnum(static_cast<unsigned char>(ch)) || ch == '_';
}

static std::string normalize_number_text(const std::string& text) {
    if (text.find_first_of(".eE") != std::string::npos) {
        return text;
    }
    return text + ".0";
}

static std::vector<Token> lex_line(const std::string& line) {
    std::vector<Token> out;
    std::size_t pos = 0;
    while (pos < line.size()) {
        char ch = line[pos];
        if (std::isspace(static_cast<unsigned char>(ch))) {
            pos += 1;
            continue;
        }
        if (std::isdigit(static_cast<unsigned char>(ch))) {
            std::size_t start = pos;
            while (pos < line.size() && std::isdigit(static_cast<unsigned char>(line[pos]))) {
                pos += 1;
            }
            if (pos < line.size() && line[pos] == '.') {
                pos += 1;
                while (pos < line.size() && std::isdigit(static_cast<unsigned char>(line[pos]))) {
                    pos += 1;
                }
            }
            if (pos < line.size() && (line[pos] == 'e' || line[pos] == 'E')) {
                std::size_t exp = pos + 1;
                if (exp < line.size() && (line[exp] == '+' || line[exp] == '-')) {
                    exp += 1;
                }
                if (exp < line.size() && std::isdigit(static_cast<unsigned char>(line[exp]))) {
                    pos = exp + 1;
                    while (pos < line.size() && std::isdigit(static_cast<unsigned char>(line[pos]))) {
                        pos += 1;
                    }
                }
            }
            out.push_back({"NUMBER", line.substr(start, pos - start)});
            continue;
        }
        if (ch == '"') {
            std::size_t start = pos;
            pos += 1;
            bool escaped = false;
            while (pos < line.size()) {
                char current = line[pos];
                if (escaped) {
                    escaped = false;
                    pos += 1;
                    continue;
                }
                if (current == '\\') {
                    escaped = true;
                    pos += 1;
                    continue;
                }
                if (current == '"') {
                    pos += 1;
                    out.push_back({"STRING", line.substr(start, pos - start)});
                    break;
                }
                pos += 1;
            }
            if (out.empty() || out.back().kind != "STRING") {
                throw std::runtime_error("native parser prototype encountered unterminated string literal");
            }
            continue;
        }
        if (is_ident_start(ch)) {
            std::size_t start = pos;
            pos += 1;
            while (pos < line.size() && is_ident_continue(line[pos])) {
                pos += 1;
            }
            out.push_back({"IDENT", line.substr(start, pos - start)});
            continue;
        }
        if (ch == ':' && pos + 1 < line.size() && line[pos + 1] == ':') {
            out.push_back({"EMIT", "::"});
            pos += 2;
            continue;
        }
        if (ch == '-' && pos + 1 < line.size() && line[pos + 1] == '>') {
            out.push_back({"ARROW", "->"});
            pos += 2;
            continue;
        }
        switch (ch) {
        case '(':
            out.push_back({"LPAREN", "("});
            break;
        case ')':
            out.push_back({"RPAREN", ")"});
            break;
        case ':':
            out.push_back({"COLON", ":"});
            break;
        case '*':
            out.push_back({"STAR", "*"});
            break;
        case '-':
            out.push_back({"MINUS", "-"});
            break;
        case '/':
            if (pos + 1 < input.size() && input[pos + 1] == '/') {
                out.push_back({"FLOOR_DIV", "//"});
                pos += 1;
            } else {
                out.push_back({"SLASH", "/"});
            }
            break;
        case '[':
            out.push_back({"LBRACKET", "["});
            break;
        case ']':
            out.push_back({"RBRACKET", "]"});
            break;
        case ',':
            out.push_back({"COMMA", ","});
            break;
        case '+':
            out.push_back({"PLUS", "+"});
            break;
        case '%':
            out.push_back({"PERCENT", "%"});
            break;
        case '.':
            out.push_back({"DOT", "."});
            break;
        case '{':
            out.push_back({"LBRACE", "{"});
            break;
        case '}':
            out.push_back({"RBRACE", "}"});
            break;
        default:
            throw std::runtime_error(std::string("Unsupported character in native parser prototype: ") + ch);
        }
        pos += 1;
    }
    return out;
}

class Parser {
public:
    explicit Parser(std::string source)
        : lines_(logical_lines(normalize_newlines(source))) {}

    std::string emit_cpp() {
        std::vector<std::vector<Token>> token_lines;
        token_lines.reserve(lines_.size());
        for (const auto& line : lines_) {
            token_lines.push_back(lex_line(line));
        }
        if (token_lines.size() == 1) {
            EmitExpressionProgram program;
            parse_emit_expression(token_lines[0], program);
            return emit_expression_cpp(program);
        }
        if (
            token_lines.size() >= 2 &&
            token_lines[0].size() >= 2 &&
            token_lines[0][0].kind == "IDENT" &&
            token_lines[0][1].kind == "LPAREN" &&
            !token_lines.back().empty() &&
            token_lines.back()[0].kind == "EMIT"
        ) {
            InlineFunctionProgram program;
            parse_inline_function_program(token_lines, program);
            return emit_inline_function_cpp(program);
        }
        if (token_lines.size() == 3) {
            HelloProgram program;
            parse_hello_header(token_lines[0], program);
            parse_hello_body(token_lines[1], program);
            parse_hello_emit(token_lines[2], program);
            return emit_hello_cpp(program);
        }
        if (token_lines.size() == 5) {
            VectorProgram program;
            parse_vector_binding(token_lines[0], program.left_binding);
            parse_vector_binding(token_lines[1], program.right_binding);
            parse_vector_header(token_lines[2], program);
            parse_vector_body(token_lines[3], program);
            parse_vector_emit(token_lines[4], program);
            validate_vector_program(program);
            return emit_vector_cpp(program);
        }
        if (token_lines.size() == 10) {
            RecordsProgram program;
            parse_records_header(token_lines[0], program);
            parse_records_body_start(token_lines[1]);
            parse_records_body_pts_line(token_lines[2], program);
            parse_records_body_bag_line(token_lines[3], program);
            parse_records_body_total_line(token_lines[4], program);
            parse_records_body_end(token_lines[5]);
            parse_records_base_binding(token_lines[6], program);
            parse_records_extra_binding(token_lines[7], program);
            parse_records_delta_binding(token_lines[8], program);
            parse_records_emit(token_lines[9], program);
            validate_records_program(program);
            return emit_records_cpp(program);
        }
        if (token_lines.size() == 7) {
            if (
                token_lines[0].size() >= 3 &&
                token_lines[0][0].kind == "IDENT" &&
                token_lines[0][1].kind == "COLON" &&
                token_lines[0][2].kind == "LBRACKET"
            ) {
                NumericProgram program;
                parse_numeric_binding(token_lines[0], program.xs_binding);
                parse_numeric_binding(token_lines[1], program.ys_binding);
                parse_numeric_emit_sin(token_lines[2]);
                parse_numeric_emit_pi(token_lines[3]);
                parse_numeric_emit_mean(token_lines[4], program);
                parse_numeric_emit_normalize(token_lines[5], program);
                parse_numeric_emit_correlation(token_lines[6], program);
                validate_numeric_program(program);
                return emit_numeric_cpp(program);
            }
            if (
                token_lines[0].size() >= 3 &&
                token_lines[0][0].kind == "IDENT" &&
                token_lines[0][1].kind == "COLON" &&
                token_lines[0][2].kind == "LPAREN"
            ) {
                NamedRecordProgram program;
                parse_named_record_typedef(token_lines[0], program);
                parse_named_record_header(token_lines[1], program);
                parse_named_record_body(token_lines[2], program);
                parse_named_record_base_binding(token_lines[3], program);
                parse_named_record_shifted_binding(token_lines[4], program);
                parse_named_record_emit_first_field(token_lines[5], program);
                parse_named_record_emit_record(token_lines[6], program);
                validate_named_record_program(program);
                return emit_named_record_cpp(program);
            }
        }
        if (token_lines.size() == 8) {
            if (
                token_lines[0].size() >= 3 &&
                token_lines[0][0].kind == "IDENT" &&
                token_lines[0][1].kind == "COLON" &&
                token_lines[0][2].kind == "LPAREN" &&
                token_lines[1].size() >= 5 &&
                token_lines[1][0].kind == "IDENT" &&
                token_lines[1][1].kind == "LPAREN" &&
                token_lines[1][2].kind == "IDENT" &&
                token_lines[1][3].kind == "COLON" &&
                token_lines[1][4].kind == "IDENT"
            ) {
                NamedRecordCollectionsProgram program;
                parse_named_record_collections_typedef(token_lines[0], program);
                parse_named_record_collections_header(token_lines[1], program);
                parse_named_record_collections_body(token_lines[2], program);
                parse_named_record_collections_base_binding(token_lines[3], program);
                parse_named_record_collections_moved_binding(token_lines[4], program);
                parse_named_record_collections_emit_vector(token_lines[5], program);
                parse_named_record_collections_emit_multiset(token_lines[6], program);
                parse_named_record_collections_emit_record(token_lines[7], program);
                validate_named_record_collections_program(program);
                return emit_named_record_collections_cpp(program);
            }
            NestedNamedRecordProgram program;
            parse_nested_named_record_point_typedef(token_lines[0], program);
            parse_nested_named_record_box_typedef(token_lines[1], program);
            parse_nested_named_record_header(token_lines[2], program);
            parse_nested_named_record_body(token_lines[3], program);
            parse_nested_named_record_base_binding(token_lines[4], program);
            parse_nested_named_record_moved_binding(token_lines[5], program);
            parse_nested_named_record_emit_origin_field(token_lines[6], program);
            parse_nested_named_record_emit_record(token_lines[7], program);
            validate_nested_named_record_program(program);
            return emit_nested_named_record_cpp(program);
        }
        if (token_lines.size() == 12) {
            if (token_lines[8].size() > 0 && token_lines[8][0].kind == "IDENT") {
                NamedRecordSceneChainProgram program;
                parse_named_record_scene_chain_point_typedef(token_lines[0], program);
                parse_named_record_scene_chain_state_typedef(token_lines[1], program);
                parse_named_record_scene_chain_scene_typedef(token_lines[2], program);
                parse_named_record_scene_chain_header(token_lines[3], program);
                parse_named_record_scene_chain_body(token_lines[4], program);
                parse_named_record_scene_chain_base_binding(token_lines[5], program);
                parse_named_record_scene_chain_shift_binding(token_lines[6], program);
                parse_named_record_scene_chain_first_binding(token_lines[7], program);
                parse_named_record_scene_chain_second_binding(token_lines[8], program);
                parse_named_record_scene_chain_emit_anchor_field(token_lines[9], program);
                parse_named_record_scene_chain_emit_total_field(token_lines[10], program);
                parse_named_record_scene_chain_emit_record(token_lines[11], program);
                validate_named_record_scene_chain_program(program);
                return emit_named_record_scene_chain_cpp(program);
            }
            NamedRecordSceneProgram program;
            parse_named_record_scene_point_typedef(token_lines[0], program);
            parse_named_record_scene_state_typedef(token_lines[1], program);
            parse_named_record_scene_scene_typedef(token_lines[2], program);
            parse_named_record_scene_header(token_lines[3], program);
            parse_named_record_scene_body(token_lines[4], program);
            parse_named_record_scene_base_binding(token_lines[5], program);
            parse_named_record_scene_shift_binding(token_lines[6], program);
            parse_named_record_scene_moved_binding(token_lines[7], program);
            parse_named_record_scene_emit_anchor_field(token_lines[8], program);
            parse_named_record_scene_emit_vector(token_lines[9], program);
            parse_named_record_scene_emit_multiset(token_lines[10], program);
            parse_named_record_scene_emit_record(token_lines[11], program);
            validate_named_record_scene_program(program);
            return emit_named_record_scene_cpp(program);
        }
        if (token_lines.size() == 16) {
            NamedRecordSceneSplitProgram program;
            parse_named_record_scene_split_point_typedef(token_lines[0], program);
            parse_named_record_scene_split_state_typedef(token_lines[1], program);
            parse_named_record_scene_split_scene_typedef(token_lines[2], program);
            parse_named_record_scene_split_shift_anchor_header(token_lines[3], program);
            parse_named_record_scene_split_shift_anchor_body(token_lines[4], program);
            parse_named_record_scene_split_bump_state_header(token_lines[5], program);
            parse_named_record_scene_split_bump_state_body(token_lines[6], program);
            parse_named_record_scene_split_step_header(token_lines[7], program);
            parse_named_record_scene_split_step_body(token_lines[8], program);
            parse_named_record_scene_split_base_binding(token_lines[9], program);
            parse_named_record_scene_split_shift_binding(token_lines[10], program);
            parse_named_record_scene_split_staged_binding(token_lines[11], program);
            parse_named_record_scene_relay_moved_binding(token_lines[12], program);
            parse_named_record_scene_split_emit_anchor_field(token_lines[13], program);
            parse_named_record_scene_split_emit_total_field(token_lines[14], program);
            parse_named_record_scene_split_emit_record(token_lines[15], program);
            validate_named_record_scene_split_program(program);
            return emit_named_record_scene_split_cpp(program);
        }
        if (token_lines.size() == 18) {
            if (
                token_lines[7].size() > 1 &&
                token_lines[7][0].text == "Scene" &&
                token_lines[9].size() > 1 &&
                token_lines[9][0].text == "Point" &&
                token_lines[10].size() > 1 &&
                token_lines[10][0].text == "State" &&
                token_lines[11].size() > 1 &&
                token_lines[11][0].text == "Scene"
            ) {
                NamedRecordSceneSplitProgram shared;
                parse_named_record_scene_split_point_typedef(token_lines[0], shared);
                parse_named_record_scene_split_state_typedef(token_lines[1], shared);
                parse_named_record_scene_split_scene_typedef(token_lines[2], shared);
                parse_named_record_scene_split_shift_anchor_header(token_lines[3], shared);
                parse_named_record_scene_split_shift_anchor_body(token_lines[4], shared);
                parse_named_record_scene_split_bump_state_header(token_lines[5], shared);
                parse_named_record_scene_split_bump_state_body(token_lines[6], shared);
                parse_named_record_scene_split_base_binding(token_lines[7], shared);
                parse_named_record_scene_split_shift_binding(token_lines[8], shared);
                NamedRecordSceneFanoutProgram program;
                program.point_type_name = shared.point_type_name;
                program.point_first_field_name = shared.point_first_field_name;
                program.point_second_field_name = shared.point_second_field_name;
                program.state_type_name = shared.state_type_name;
                program.vector_field_name = shared.vector_field_name;
                program.multiset_field_name = shared.multiset_field_name;
                program.total_field_name = shared.total_field_name;
                program.scene_type_name = shared.scene_type_name;
                program.anchor_field_name = shared.anchor_field_name;
                program.state_field_name = shared.state_field_name;
                program.shift_anchor_function_name = shared.shift_anchor_function_name;
                program.shift_anchor_param_name = shared.shift_anchor_param_name;
                program.shift_anchor_shift_name = shared.shift_anchor_shift_name;
                program.bump_state_function_name = shared.bump_state_function_name;
                program.bump_state_param_name = shared.bump_state_param_name;
                program.bump_state_extra_name = shared.bump_state_extra_name;
                program.bump_state_delta_name = shared.bump_state_delta_name;
                program.base_name = shared.base_name;
                program.base_anchor_first_value = shared.base_anchor_first_value;
                program.base_anchor_second_value = shared.base_anchor_second_value;
                program.base_vector_first_value = shared.base_vector_first_value;
                program.base_vector_second_value = shared.base_vector_second_value;
                program.base_multiset_key = shared.base_multiset_key;
                program.base_multiset_count = shared.base_multiset_count;
                program.base_total_value = shared.base_total_value;
                program.shift_name = shared.shift_name;
                program.shift_first_value = shared.shift_first_value;
                program.shift_second_value = shared.shift_second_value;
                parse_named_record_scene_fanout_first_anchor_binding(token_lines[9], program);
                parse_named_record_scene_fanout_first_state_binding(token_lines[10], program);
                parse_named_record_scene_fanout_first_binding(token_lines[11], program);
                parse_named_record_scene_fanout_second_anchor_binding(token_lines[12], program);
                parse_named_record_scene_fanout_second_state_binding(token_lines[13], program);
                parse_named_record_scene_fanout_second_binding(token_lines[14], program);
                parse_named_record_scene_fanout_emit_anchor_field(token_lines[15], program);
                parse_named_record_scene_fanout_emit_total_field(token_lines[16], program);
                parse_named_record_scene_fanout_emit_record(token_lines[17], program);
                validate_named_record_scene_fanout_program(program);
                return emit_named_record_scene_fanout_cpp(program);
            }
            if (
                token_lines[11].size() > 1 &&
                token_lines[11][0].text == "Scene" &&
                token_lines[12].size() > 1 &&
                token_lines[12][0].text == "Scene" &&
                token_lines[13].size() > 1 &&
                token_lines[13][0].text == "Scene"
            ) {
                NamedRecordSceneRebuildProgram program;
                parse_named_record_scene_rebuild_point_typedef(token_lines[0], program);
                parse_named_record_scene_rebuild_state_typedef(token_lines[1], program);
                parse_named_record_scene_rebuild_scene_typedef(token_lines[2], program);
                parse_named_record_scene_rebuild_shift_anchor_header(token_lines[3], program);
                parse_named_record_scene_rebuild_shift_anchor_body(token_lines[4], program);
                parse_named_record_scene_rebuild_bump_state_header(token_lines[5], program);
                parse_named_record_scene_rebuild_bump_state_body(token_lines[6], program);
                parse_named_record_scene_rebuild_step_header(token_lines[7], program);
                parse_named_record_scene_rebuild_step_body(token_lines[8], program);
                parse_named_record_scene_rebuild_base_binding(token_lines[9], program);
                parse_named_record_scene_rebuild_shift_binding(token_lines[10], program);
                parse_named_record_scene_rebuild_staged_binding(token_lines[11], program);
                parse_named_record_scene_rebuild_moved_anchor_binding(token_lines[12], program);
                parse_named_record_scene_crossfade_moved_state_binding(token_lines[13], program);
                parse_named_record_scene_crossfade_moved_binding(token_lines[14], program);
                parse_named_record_scene_crossfade_emit_anchor_field(token_lines[15], program);
                parse_named_record_scene_rebuild_emit_total_field(token_lines[16], program);
                parse_named_record_scene_rebuild_emit_record(token_lines[17], program);
                validate_named_record_scene_rebuild_program(program);
                return emit_named_record_scene_rebuild_cpp(program);
            }
            if (
                token_lines[11].size() > 1 &&
                token_lines[11][0].text == "Scene" &&
                token_lines[12].size() > 1 &&
                token_lines[12][0].text == "Point" &&
                token_lines[13].size() > 1 &&
                token_lines[13][0].text == "State"
            ) {
                NamedRecordSceneSplitProgram program;
                parse_named_record_scene_split_point_typedef(token_lines[0], program);
                parse_named_record_scene_split_state_typedef(token_lines[1], program);
                parse_named_record_scene_split_scene_typedef(token_lines[2], program);
                parse_named_record_scene_split_shift_anchor_header(token_lines[3], program);
                parse_named_record_scene_split_shift_anchor_body(token_lines[4], program);
                parse_named_record_scene_split_bump_state_header(token_lines[5], program);
                parse_named_record_scene_split_bump_state_body(token_lines[6], program);
                parse_named_record_scene_split_step_header(token_lines[7], program);
                parse_named_record_scene_split_step_body(token_lines[8], program);
                parse_named_record_scene_split_base_binding(token_lines[9], program);
                parse_named_record_scene_split_shift_binding(token_lines[10], program);
                parse_named_record_scene_split_staged_binding(token_lines[11], program);
                parse_named_record_scene_split_final_anchor_binding(token_lines[12], program);
                parse_named_record_scene_split_final_state_binding(token_lines[13], program);
                parse_named_record_scene_split_moved_binding(token_lines[14], program);
                parse_named_record_scene_split_emit_anchor_field(token_lines[15], program);
                parse_named_record_scene_split_emit_total_field(token_lines[16], program);
                parse_named_record_scene_split_emit_record(token_lines[17], program);
                validate_named_record_scene_split_program(program);
                return emit_named_record_scene_split_cpp(program);
            }
            NamedRecordSceneHelpersProgram program;
            parse_named_record_scene_helpers_point_typedef(token_lines[0], program);
            parse_named_record_scene_helpers_state_typedef(token_lines[1], program);
            parse_named_record_scene_helpers_scene_typedef(token_lines[2], program);
            parse_named_record_scene_helpers_shift_anchor_header(token_lines[3], program);
            parse_named_record_scene_helpers_shift_anchor_body(token_lines[4], program);
            parse_named_record_scene_helpers_bump_state_header(token_lines[5], program);
            parse_named_record_scene_helpers_bump_state_body(token_lines[6], program);
            parse_named_record_scene_helpers_step_header(token_lines[7], program);
            parse_named_record_scene_helpers_step_next_anchor(token_lines[8], program);
            parse_named_record_scene_helpers_step_next_state(token_lines[9], program);
            parse_named_record_scene_helpers_step_out_binding(token_lines[10], program);
            parse_named_record_scene_helpers_step_out_return(token_lines[11], program);
            parse_named_record_scene_helpers_base_binding(token_lines[12], program);
            parse_named_record_scene_helpers_shift_binding(token_lines[13], program);
            parse_named_record_scene_helpers_moved_binding(token_lines[14], program);
            parse_named_record_scene_helpers_emit_anchor_field(token_lines[15], program);
            parse_named_record_scene_helpers_emit_total_field(token_lines[16], program);
            parse_named_record_scene_helpers_emit_record(token_lines[17], program);
            validate_named_record_scene_helpers_program(program);
            return emit_named_record_scene_helpers_cpp(program);
        }
        if (token_lines.size() == 21) {
            if (token_lines[7].size() > 0 && token_lines[7][0].text == "move_anchor") {
                NamedRecordSceneOverlayProgram shared;
                parse_named_record_scene_overlay_point_typedef(token_lines[0], shared);
                parse_named_record_scene_overlay_state_typedef(token_lines[1], shared);
                parse_named_record_scene_overlay_scene_typedef(token_lines[2], shared);
                parse_named_record_scene_overlay_shift_anchor_header(token_lines[3], shared);
                parse_named_record_scene_overlay_shift_anchor_body(token_lines[4], shared);
                parse_named_record_scene_overlay_bump_state_header(token_lines[5], shared);
                parse_named_record_scene_overlay_bump_state_body(token_lines[6], shared);
                parse_named_record_scene_overlay_move_anchor_header(token_lines[7], shared);
                parse_named_record_scene_overlay_move_anchor_body(token_lines[8], shared);
                parse_named_record_scene_overlay_fill_state_header(token_lines[9], shared);
                parse_named_record_scene_overlay_fill_state_body(token_lines[10], shared);
                parse_named_record_scene_overlay_base_binding(token_lines[11], shared);
                parse_named_record_scene_overlay_shift_binding(token_lines[12], shared);
                parse_named_record_scene_overlay_shifted_binding(token_lines[13], shared);
                parse_named_record_scene_overlay_filled_binding(token_lines[14], shared);
                NamedRecordSceneSpliceProgram program;
                program.point_type_name = shared.point_type_name;
                program.point_first_field_name = shared.point_first_field_name;
                program.point_second_field_name = shared.point_second_field_name;
                program.state_type_name = shared.state_type_name;
                program.vector_field_name = shared.vector_field_name;
                program.multiset_field_name = shared.multiset_field_name;
                program.total_field_name = shared.total_field_name;
                program.scene_type_name = shared.scene_type_name;
                program.anchor_field_name = shared.anchor_field_name;
                program.state_field_name = shared.state_field_name;
                program.shift_anchor_function_name = shared.shift_anchor_function_name;
                program.shift_anchor_param_name = shared.shift_anchor_param_name;
                program.shift_anchor_shift_name = shared.shift_anchor_shift_name;
                program.bump_state_function_name = shared.bump_state_function_name;
                program.bump_state_param_name = shared.bump_state_param_name;
                program.bump_state_extra_name = shared.bump_state_extra_name;
                program.bump_state_delta_name = shared.bump_state_delta_name;
                program.move_anchor_function_name = shared.move_anchor_function_name;
                program.move_anchor_scene_name = shared.move_anchor_scene_name;
                program.move_anchor_shift_name = shared.move_anchor_shift_name;
                program.fill_state_function_name = shared.fill_state_function_name;
                program.fill_state_scene_name = shared.fill_state_scene_name;
                program.fill_state_extra_name = shared.fill_state_extra_name;
                program.fill_state_delta_name = shared.fill_state_delta_name;
                program.base_name = shared.base_name;
                program.base_anchor_first_value = shared.base_anchor_first_value;
                program.base_anchor_second_value = shared.base_anchor_second_value;
                program.base_vector_first_value = shared.base_vector_first_value;
                program.base_vector_second_value = shared.base_vector_second_value;
                program.base_multiset_key = shared.base_multiset_key;
                program.base_multiset_count = shared.base_multiset_count;
                program.base_total_value = shared.base_total_value;
                program.shift_name = shared.shift_name;
                program.shift_first_value = shared.shift_first_value;
                program.shift_second_value = shared.shift_second_value;
                program.shifted_name = shared.shifted_name;
                program.filled_name = shared.filled_name;
                parse_named_record_scene_splice_final_anchor_binding(token_lines[15], program);
                parse_named_record_scene_splice_final_state_binding(token_lines[16], program);
                parse_named_record_scene_splice_moved_binding(token_lines[17], program);
                parse_named_record_scene_splice_emit_anchor_field(token_lines[18], program);
                parse_named_record_scene_splice_emit_total_field(token_lines[19], program);
                parse_named_record_scene_splice_emit_record(token_lines[20], program);
                validate_named_record_scene_splice_program(program);
                return emit_named_record_scene_splice_cpp(program);
            }
        }
        if (token_lines.size() == 19) {
            if (
                token_lines[11].size() > 1 &&
                token_lines[11][0].text == "Scene" &&
                token_lines[12].size() > 1 &&
                token_lines[12][0].text == "Scene" &&
                token_lines[13].size() > 1 &&
                token_lines[13][0].text == "Point"
            ) {
                NamedRecordSceneSplitProgram program;
                parse_named_record_scene_split_point_typedef(token_lines[0], program);
                parse_named_record_scene_split_state_typedef(token_lines[1], program);
                parse_named_record_scene_split_scene_typedef(token_lines[2], program);
                parse_named_record_scene_split_shift_anchor_header(token_lines[3], program);
                parse_named_record_scene_split_shift_anchor_body(token_lines[4], program);
                parse_named_record_scene_split_bump_state_header(token_lines[5], program);
                parse_named_record_scene_split_bump_state_body(token_lines[6], program);
                parse_named_record_scene_split_step_header(token_lines[7], program);
                parse_named_record_scene_split_step_body(token_lines[8], program);
                parse_named_record_scene_split_base_binding(token_lines[9], program);
                parse_named_record_scene_split_shift_binding(token_lines[10], program);
                parse_named_record_scene_split_staged_binding(token_lines[11], program);
                parse_named_record_scene_reverse_moved_state_binding(token_lines[12], program);
                parse_named_record_scene_reverse_final_anchor_binding(token_lines[13], program);
                parse_named_record_scene_reverse_final_state_binding(token_lines[14], program);
                parse_named_record_scene_split_moved_binding(token_lines[15], program);
                parse_named_record_scene_split_emit_anchor_field(token_lines[16], program);
                parse_named_record_scene_split_emit_total_field(token_lines[17], program);
                parse_named_record_scene_split_emit_record(token_lines[18], program);
                validate_named_record_scene_split_program(program);
                return emit_named_record_scene_split_cpp(program);
            }
            if (token_lines[7].size() > 0 && token_lines[7][0].text == "move_anchor") {
                NamedRecordSceneOverlayProgram program;
                parse_named_record_scene_overlay_point_typedef(token_lines[0], program);
                parse_named_record_scene_overlay_state_typedef(token_lines[1], program);
                parse_named_record_scene_overlay_scene_typedef(token_lines[2], program);
                parse_named_record_scene_overlay_shift_anchor_header(token_lines[3], program);
                parse_named_record_scene_overlay_shift_anchor_body(token_lines[4], program);
                parse_named_record_scene_overlay_bump_state_header(token_lines[5], program);
                parse_named_record_scene_overlay_bump_state_body(token_lines[6], program);
                parse_named_record_scene_overlay_move_anchor_header(token_lines[7], program);
                parse_named_record_scene_overlay_move_anchor_body(token_lines[8], program);
                parse_named_record_scene_overlay_fill_state_header(token_lines[9], program);
                parse_named_record_scene_overlay_fill_state_body(token_lines[10], program);
                parse_named_record_scene_overlay_base_binding(token_lines[11], program);
                parse_named_record_scene_overlay_shift_binding(token_lines[12], program);
                parse_named_record_scene_overlay_shifted_binding(token_lines[13], program);
                parse_named_record_scene_overlay_filled_binding(token_lines[14], program);
                parse_named_record_scene_overlay_moved_binding(token_lines[15], program);
                parse_named_record_scene_overlay_emit_anchor_field(token_lines[16], program);
                parse_named_record_scene_overlay_emit_total_field(token_lines[17], program);
                parse_named_record_scene_overlay_emit_record(token_lines[18], program);
                validate_named_record_scene_overlay_program(program);
                return emit_named_record_scene_overlay_cpp(program);
            }
            NamedRecordSceneHandoffProgram program;
            parse_named_record_scene_handoff_point_typedef(token_lines[0], program);
            parse_named_record_scene_handoff_state_typedef(token_lines[1], program);
            parse_named_record_scene_handoff_scene_typedef(token_lines[2], program);
            parse_named_record_scene_handoff_shift_anchor_header(token_lines[3], program);
            parse_named_record_scene_handoff_shift_anchor_body(token_lines[4], program);
            parse_named_record_scene_handoff_bump_state_header(token_lines[5], program);
            parse_named_record_scene_handoff_bump_state_body(token_lines[6], program);
            parse_named_record_scene_handoff_step_header(token_lines[7], program);
            parse_named_record_scene_handoff_step_next_anchor(token_lines[8], program);
            parse_named_record_scene_handoff_step_next_state(token_lines[9], program);
            parse_named_record_scene_handoff_step_out_binding(token_lines[10], program);
            parse_named_record_scene_handoff_step_out_return(token_lines[11], program);
            parse_named_record_scene_handoff_base_binding(token_lines[12], program);
            parse_named_record_scene_handoff_shift_binding(token_lines[13], program);
            parse_named_record_scene_handoff_first_binding(token_lines[14], program);
            parse_named_record_scene_handoff_second_binding(token_lines[15], program);
            parse_named_record_scene_handoff_emit_anchor_field(token_lines[16], program);
            parse_named_record_scene_handoff_emit_total_field(token_lines[17], program);
            parse_named_record_scene_handoff_emit_record(token_lines[18], program);
            validate_named_record_scene_handoff_program(program);
            return emit_named_record_scene_handoff_cpp(program);
        }
        if (token_lines.size() == 17) {
            if (
                token_lines[11].size() > 1 &&
                token_lines[11][0].text == "Scene" &&
                token_lines[12].size() == 4 &&
                token_lines[13].size() == 4
            ) {
                NamedRecordSceneSplitProgram shared;
                parse_named_record_scene_split_point_typedef(token_lines[0], shared);
                parse_named_record_scene_split_state_typedef(token_lines[1], shared);
                parse_named_record_scene_split_scene_typedef(token_lines[2], shared);
                parse_named_record_scene_split_shift_anchor_header(token_lines[3], shared);
                parse_named_record_scene_split_shift_anchor_body(token_lines[4], shared);
                parse_named_record_scene_split_bump_state_header(token_lines[5], shared);
                parse_named_record_scene_split_bump_state_body(token_lines[6], shared);
                parse_named_record_scene_split_step_header(token_lines[7], shared);
                parse_named_record_scene_split_step_body(token_lines[8], shared);
                parse_named_record_scene_split_base_binding(token_lines[9], shared);
                parse_named_record_scene_split_shift_binding(token_lines[10], shared);
                parse_named_record_scene_split_staged_binding(token_lines[11], shared);
                NamedRecordSceneCheckpointProgram program;
                program.point_type_name = shared.point_type_name;
                program.point_first_field_name = shared.point_first_field_name;
                program.point_second_field_name = shared.point_second_field_name;
                program.state_type_name = shared.state_type_name;
                program.vector_field_name = shared.vector_field_name;
                program.multiset_field_name = shared.multiset_field_name;
                program.total_field_name = shared.total_field_name;
                program.scene_type_name = shared.scene_type_name;
                program.anchor_field_name = shared.anchor_field_name;
                program.state_field_name = shared.state_field_name;
                program.step_function_name = shared.step_function_name;
                program.scene_param_name = shared.scene_param_name;
                program.shift_param_name = shared.shift_param_name;
                program.extra_param_name = shared.extra_param_name;
                program.delta_param_name = shared.delta_param_name;
                program.shift_anchor_function_name = shared.shift_anchor_function_name;
                program.shift_anchor_param_name = shared.shift_anchor_param_name;
                program.shift_anchor_shift_name = shared.shift_anchor_shift_name;
                program.bump_state_function_name = shared.bump_state_function_name;
                program.bump_state_param_name = shared.bump_state_param_name;
                program.bump_state_extra_name = shared.bump_state_extra_name;
                program.bump_state_delta_name = shared.bump_state_delta_name;
                program.base_name = shared.base_name;
                program.base_anchor_first_value = shared.base_anchor_first_value;
                program.base_anchor_second_value = shared.base_anchor_second_value;
                program.base_vector_first_value = shared.base_vector_first_value;
                program.base_vector_second_value = shared.base_vector_second_value;
                program.base_multiset_key = shared.base_multiset_key;
                program.base_multiset_count = shared.base_multiset_count;
                program.base_total_value = shared.base_total_value;
                program.shift_name = shared.shift_name;
                program.shift_first_value = shared.shift_first_value;
                program.shift_second_value = shared.shift_second_value;
                program.staged_name = shared.staged_name;
                parse_named_record_scene_checkpoint_checkpoint_binding(token_lines[12], program);
                parse_named_record_scene_checkpoint_moved_binding(token_lines[13], program);
                parse_named_record_scene_checkpoint_emit_anchor_field(token_lines[14], program);
                parse_named_record_scene_checkpoint_emit_total_field(token_lines[15], program);
                parse_named_record_scene_checkpoint_emit_record(token_lines[16], program);
                validate_named_record_scene_checkpoint_program(program);
                return emit_named_record_scene_checkpoint_cpp(program);
            }
            if (
                token_lines[11].size() > 1 &&
                token_lines[11][0].text == "Scene" &&
                token_lines[12].size() > 1 &&
                token_lines[12][0].text == "Scene" &&
                token_lines[13].size() > 1 &&
                token_lines[13][0].text == "Scene"
            ) {
                NamedRecordSceneRebuildProgram program;
                parse_named_record_scene_rebuild_point_typedef(token_lines[0], program);
                parse_named_record_scene_rebuild_state_typedef(token_lines[1], program);
                parse_named_record_scene_rebuild_scene_typedef(token_lines[2], program);
                parse_named_record_scene_rebuild_shift_anchor_header(token_lines[3], program);
                parse_named_record_scene_rebuild_shift_anchor_body(token_lines[4], program);
                parse_named_record_scene_rebuild_bump_state_header(token_lines[5], program);
                parse_named_record_scene_rebuild_bump_state_body(token_lines[6], program);
                parse_named_record_scene_rebuild_step_header(token_lines[7], program);
                parse_named_record_scene_rebuild_step_body(token_lines[8], program);
                parse_named_record_scene_rebuild_base_binding(token_lines[9], program);
                parse_named_record_scene_rebuild_shift_binding(token_lines[10], program);
                parse_named_record_scene_rebuild_staged_binding(token_lines[11], program);
                parse_named_record_scene_rebuild_moved_anchor_binding(token_lines[12], program);
                parse_named_record_scene_rebuild_moved_binding(token_lines[13], program);
                parse_named_record_scene_rebuild_emit_anchor_field(token_lines[14], program);
                parse_named_record_scene_rebuild_emit_total_field(token_lines[15], program);
                parse_named_record_scene_rebuild_emit_record(token_lines[16], program);
                validate_named_record_scene_rebuild_program(program);
                return emit_named_record_scene_rebuild_cpp(program);
            }
            if (token_lines[7].size() > 0 && token_lines[7][0].text == "move_anchor") {
                NamedRecordScenePatchProgram program;
                parse_named_record_scene_patch_point_typedef(token_lines[0], program);
                parse_named_record_scene_patch_state_typedef(token_lines[1], program);
                parse_named_record_scene_patch_scene_typedef(token_lines[2], program);
                parse_named_record_scene_patch_shift_anchor_header(token_lines[3], program);
                parse_named_record_scene_patch_shift_anchor_body(token_lines[4], program);
                parse_named_record_scene_patch_bump_state_header(token_lines[5], program);
                parse_named_record_scene_patch_bump_state_body(token_lines[6], program);
                parse_named_record_scene_patch_move_anchor_header(token_lines[7], program);
                parse_named_record_scene_patch_move_anchor_body(token_lines[8], program);
                parse_named_record_scene_patch_base_binding(token_lines[9], program);
                parse_named_record_scene_patch_shift_binding(token_lines[10], program);
                parse_named_record_scene_patch_shifted_binding(token_lines[11], program);
                parse_named_record_scene_patch_patched_binding(token_lines[12], program);
                parse_named_record_scene_patch_moved_binding(token_lines[13], program);
                parse_named_record_scene_patch_emit_anchor_field(token_lines[14], program);
                parse_named_record_scene_patch_emit_total_field(token_lines[15], program);
                parse_named_record_scene_patch_emit_record(token_lines[16], program);
                validate_named_record_scene_patch_program(program);
                return emit_named_record_scene_patch_cpp(program);
            }
            NamedRecordSceneComposeProgram program;
            parse_named_record_scene_compose_point_typedef(token_lines[0], program);
            parse_named_record_scene_compose_state_typedef(token_lines[1], program);
            parse_named_record_scene_compose_scene_typedef(token_lines[2], program);
            parse_named_record_scene_compose_shift_anchor_header(token_lines[3], program);
            parse_named_record_scene_compose_shift_anchor_body(token_lines[4], program);
            parse_named_record_scene_compose_bump_state_header(token_lines[5], program);
            parse_named_record_scene_compose_bump_state_body(token_lines[6], program);
            parse_named_record_scene_compose_step_header(token_lines[7], program);
            parse_named_record_scene_compose_step_body(token_lines[8], program);
            parse_named_record_scene_compose_base_binding(token_lines[9], program);
            parse_named_record_scene_compose_shift_binding(token_lines[10], program);
            parse_named_record_scene_compose_moved_anchor_binding(token_lines[11], program);
            parse_named_record_scene_compose_staged_binding(token_lines[12], program);
            parse_named_record_scene_compose_moved_binding(token_lines[13], program);
            parse_named_record_scene_compose_emit_anchor_field(token_lines[14], program);
            parse_named_record_scene_compose_emit_total_field(token_lines[15], program);
            parse_named_record_scene_compose_emit_record(token_lines[16], program);
            validate_named_record_scene_compose_program(program);
            return emit_named_record_scene_compose_cpp(program);
        }
        throw std::runtime_error("native parser prototype expects hello-native, one-line emit-expression, inline arithmetic helper, vectors-native, records-native, numeric-native, named-record-native, named-record-collections-native, named-record-scene-native, named-record-scene-chain-native, named-record-scene-helpers-native, named-record-scene-handoff-native, named-record-scene-relay-native, named-record-scene-compose-native, named-record-scene-patch-native, named-record-scene-split-native, named-record-scene-rebuild-native, named-record-scene-checkpoint-native, named-record-scene-splice-native, named-record-scene-fanout-native, named-record-scene-overlay-native, named-record-scene-reverse-native, named-record-scene-crossfade-native, or nested-named-record-native logical shape");
    }

private:
    std::vector<std::string> lines_;

    static void parse_emit_expression(const std::vector<Token>& tokens, EmitExpressionProgram& program) {
        if (tokens.empty() || tokens[0].kind != "EMIT") {
            throw std::runtime_error("native parser prototype expected emit-expression logical shape");
        }
        if (tokens.size() < 2) {
            throw std::runtime_error("native parser prototype expected expression after ::");
        }
        program.expression_tokens.assign(tokens.begin() + 1, tokens.end());
        std::size_t position = 0;
        program.cpp_expression = parse_emit_expression_text(program.expression_tokens, position);
        if (position != program.expression_tokens.size()) {
            throw std::runtime_error("native parser prototype only supports simple literal/arithmetic emit expressions");
        }
    }

    static bool try_find_inline_function_arity(
        const std::vector<InlineFunctionDefinition>& functions,
        const std::string& function_name,
        std::size_t& out_arity
    ) {
        for (const auto& function : functions) {
            if (function.function_name == function_name) {
                out_arity = function.param_names.size();
                return true;
            }
        }
        return false;
    }

    static std::string parse_inline_body_expression_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers,
        const std::vector<InlineFunctionDefinition>& functions
    ) {
        std::string left = parse_inline_body_term_text(tokens, position, allowed_identifiers, functions);
        while (position < tokens.size()) {
            const std::string& kind = tokens[position].kind;
            if (kind != "PLUS" && kind != "MINUS") {
                break;
            }
            const std::string op = tokens[position].text;
            position += 1;
            std::string right = parse_inline_body_term_text(tokens, position, allowed_identifiers, functions);
            left = "(" + left + " " + op + " " + right + ")";
        }
        return left;
    }

    static std::string parse_inline_body_term_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers,
        const std::vector<InlineFunctionDefinition>& functions
    ) {
        std::string left = parse_inline_body_unary_text(tokens, position, allowed_identifiers, functions);
        while (position < tokens.size()) {
            const std::string& kind = tokens[position].kind;
            if (kind != "STAR" && kind != "SLASH" && kind != "FLOOR_DIV" && kind != "PERCENT") {
                break;
            }
            const std::string op = tokens[position].text;
            position += 1;
            std::string right = parse_inline_body_unary_text(tokens, position, allowed_identifiers, functions);
            left = "(" + left + " " + op + " " + right + ")";
        }
        return left;
    }

    static std::string parse_inline_body_unary_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers,
        const std::vector<InlineFunctionDefinition>& functions
    ) {
        if (position < tokens.size() && tokens[position].kind == "MINUS") {
            position += 1;
            return "(-" + parse_inline_body_unary_text(tokens, position, allowed_identifiers, functions) + ")";
        }
        return parse_inline_body_primary_text(tokens, position, allowed_identifiers, functions);
    }

    static std::string parse_inline_body_primary_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers,
        const std::vector<InlineFunctionDefinition>& functions
    ) {
        if (position >= tokens.size()) {
            throw std::runtime_error("native parser prototype expected inline helper body primary");
        }
        const Token& token = tokens[position];
        std::size_t function_arity = 0;
        if (
            token.kind == "IDENT" &&
            try_find_inline_function_arity(functions, token.text, function_arity) &&
            position + 1 < tokens.size() &&
            tokens[position + 1].kind == "LPAREN"
        ) {
            const std::string function_name = token.text;
            position += 2;
            std::vector<std::string> args;
            bool expect_arg = true;
            while (position < tokens.size()) {
                if (tokens[position].kind == "RPAREN") {
                    position += 1;
                    break;
                }
                if (!expect_arg) {
                    expect_kind(tokens, position, "COMMA");
                    position += 1;
                }
                args.push_back(
                    parse_inline_body_expression_text(
                        tokens,
                        position,
                        allowed_identifiers,
                        functions
                    )
                );
                expect_arg = false;
            }
            if (args.size() != function_arity) {
                throw std::runtime_error("native parser prototype inline helper body call arity must match declared parameters");
            }
            std::ostringstream out;
            out << function_name << "(";
            for (std::size_t i = 0; i < args.size(); ++i) {
                if (i > 0) {
                    out << ", ";
                }
                out << args[i];
            }
            out << ")";
            return out.str();
        }
        if (token.kind == "LPAREN") {
            position += 1;
            std::string inner = parse_inline_body_expression_text(
                tokens,
                position,
                allowed_identifiers,
                functions
            );
            if (position >= tokens.size() || tokens[position].kind != "RPAREN") {
                throw std::runtime_error("native parser prototype expected closing ) in inline helper body expression");
            }
            position += 1;
            return "(" + inner + ")";
        }
        return parse_numeric_primary_text(tokens, position, allowed_identifiers);
    }

    static void parse_inline_function_signature(
        const std::vector<Token>& function_tokens,
        InlineFunctionDefinition& function,
        const std::vector<InlineFunctionDefinition>& prior_functions
    ) {
        if (function_tokens.size() < 6) {
            throw std::runtime_error("native parser prototype expected inline function logical shape");
        }
        expect_kind(function_tokens, 0, "IDENT");
        expect_kind(function_tokens, 1, "LPAREN");
        function.function_name = function_tokens[0].text;
        std::size_t position = 2;
        bool expect_param = true;
        while (position < function_tokens.size()) {
            if (function_tokens[position].kind == "RPAREN") {
                position += 1;
                break;
            }
            if (!expect_param) {
                expect_kind(function_tokens, position, "COMMA");
                position += 1;
            }
            expect_kind(function_tokens, position, "IDENT");
            function.param_names.push_back(function_tokens[position].text);
            position += 1;
            if (position < function_tokens.size() && function_tokens[position].kind == "COLON") {
                position += 1;
                expect_kind(function_tokens, position, "IDENT");
                if (function_tokens[position].text != "num") {
                    throw std::runtime_error("native parser prototype only supports num-typed inline helper parameters");
                }
                position += 1;
            }
            expect_param = false;
        }
        if (position < function_tokens.size() && function_tokens[position].kind == "ARROW") {
            position += 1;
            expect_kind(function_tokens, position, "IDENT");
            if (function_tokens[position].text != "num") {
                throw std::runtime_error("native parser prototype only supports num return type for typed inline helpers");
            }
            position += 1;
        }
        if (position >= function_tokens.size() || function_tokens[position].kind != "COLON") {
            throw std::runtime_error("native parser prototype expected ':' after inline function parameters");
        }
        position += 1;
        if (position >= function_tokens.size()) {
            function.return_cpp_expression.clear();
            return;
        }
        function.has_inline_signature_body = true;
        std::vector<Token> body_tokens(
            function_tokens.begin() + static_cast<std::ptrdiff_t>(position),
            function_tokens.end()
        );
        std::vector<std::string> allowed_identifiers = function.param_names;
        std::size_t body_position = 0;
        function.return_cpp_expression = parse_inline_body_expression_text(
            body_tokens,
            body_position,
            allowed_identifiers,
            prior_functions
        );
        if (body_position != body_tokens.size()) {
            throw std::runtime_error("native parser prototype only supports simple arithmetic inline function bodies");
        }
    }

    static bool is_inline_function_signature_line(const std::vector<Token>& tokens) {
        return tokens.size() >= 2 && tokens[0].kind == "IDENT" && tokens[1].kind == "LPAREN";
    }

    static bool inline_signature_line_has_inline_body(const std::vector<Token>& tokens) {
        return !tokens.empty() && tokens.back().kind != "COLON";
    }

    static void parse_inline_function_block_lines(
        const std::vector<std::vector<Token>>& token_lines,
        std::size_t start_index,
        std::size_t end_index,
        InlineFunctionDefinition& function,
        const std::vector<InlineFunctionDefinition>& prior_functions
    ) {
        if (start_index >= end_index) {
            throw std::runtime_error("native parser prototype expected inline function program shape");
        }
        parse_inline_function_signature(token_lines[start_index], function, prior_functions);
        std::vector<std::string> allowed_identifiers = function.param_names;
        bool saw_block_return = false;
        for (std::size_t line_index = start_index + 1; line_index < end_index; ++line_index) {
            const auto& line_tokens = token_lines[line_index];
            if (line_tokens.size() >= 3 && line_tokens[0].kind == "IDENT" && line_tokens[1].kind == "COLON") {
                std::vector<Token> expr_tokens(line_tokens.begin() + 2, line_tokens.end());
                std::size_t expr_position = 0;
                std::string expr = parse_inline_body_expression_text(
                    expr_tokens,
                    expr_position,
                    allowed_identifiers,
                    prior_functions
                );
                if (expr_position != expr_tokens.size()) {
                    throw std::runtime_error("native parser prototype only supports arithmetic local bindings in helper blocks");
                }
                function.local_bindings.push_back({line_tokens[0].text, expr});
                allowed_identifiers.push_back(line_tokens[0].text);
                continue;
            }
            std::size_t return_position = 0;
            function.return_cpp_expression = parse_inline_body_expression_text(
                line_tokens,
                return_position,
                allowed_identifiers,
                prior_functions
            );
            if (return_position != line_tokens.size()) {
                throw std::runtime_error("native parser prototype only supports arithmetic final return expressions in helper blocks");
            }
            if (line_index + 1 != end_index) {
                throw std::runtime_error("native parser prototype expects final return expression immediately before the next helper or emit call");
            }
            saw_block_return = true;
        }
        if (function.return_cpp_expression.empty() && !saw_block_return) {
            throw std::runtime_error("native parser prototype expected inline helper body expression");
        }
    }

    static void parse_inline_function_program(
        const std::vector<std::vector<Token>>& token_lines,
        InlineFunctionProgram& program
    ) {
        if (token_lines.size() < 2) {
            throw std::runtime_error("native parser prototype expected inline function program shape");
        }
        std::size_t emit_index = token_lines.size() - 1;
        std::size_t line_index = 0;
        bool parsing_top_level_bindings = false;
        std::vector<std::string> top_level_identifiers;
        while (line_index < emit_index) {
            if (parsing_top_level_bindings) {
                const auto& line_tokens = token_lines[line_index];
                if (!(line_tokens.size() >= 3 && line_tokens[0].kind == "IDENT" && line_tokens[1].kind == "COLON")) {
                    throw std::runtime_error("native parser prototype only supports arithmetic top-level bindings before emit");
                }
                std::vector<Token> expr_tokens(line_tokens.begin() + 2, line_tokens.end());
                std::size_t expr_position = 0;
                std::string expr = parse_inline_body_expression_text(
                    expr_tokens,
                    expr_position,
                    top_level_identifiers,
                    program.functions
                );
                if (expr_position != expr_tokens.size()) {
                    throw std::runtime_error("native parser prototype only supports arithmetic top-level bindings before emit");
                }
                program.top_level_bindings.push_back({line_tokens[0].text, expr});
                top_level_identifiers.push_back(line_tokens[0].text);
                line_index += 1;
                continue;
            }
            if (!is_inline_function_signature_line(token_lines[line_index])) {
                throw std::runtime_error("native parser prototype expected helper declaration before emit call");
            }
            std::size_t next_index = line_index + 1;
            if (!inline_signature_line_has_inline_body(token_lines[line_index])) {
                while (
                    next_index < emit_index &&
                    !is_inline_function_signature_line(token_lines[next_index])
                ) {
                    next_index += 1;
                }
            }
            InlineFunctionDefinition function;
            parse_inline_function_block_lines(token_lines, line_index, next_index, function, program.functions);
            program.functions.push_back(function);
            if (
                function.has_inline_signature_body &&
                next_index < emit_index &&
                !is_inline_function_signature_line(token_lines[next_index])
            ) {
                parsing_top_level_bindings = true;
            }
            line_index = next_index;
        }
        if (program.functions.empty()) {
            throw std::runtime_error("native parser prototype expected at least one inline helper declaration");
        }
        parse_inline_function_emit(token_lines.back(), program);
    }

    static void parse_inline_function_emit(
        const std::vector<Token>& tokens,
        InlineFunctionProgram& program
    ) {
        if (tokens.size() < 2) {
            throw std::runtime_error("native parser prototype expected inline function emit-expression shape");
        }
        expect_kind(tokens, 0, "EMIT");
        std::vector<Token> expr_tokens(tokens.begin() + 1, tokens.end());
        std::size_t position = 0;
        std::vector<std::string> allowed_identifiers;
        for (const auto& binding : program.top_level_bindings) {
            allowed_identifiers.push_back(binding.first);
        }
        program.emit_cpp_expression = parse_inline_emit_expression_text(
            expr_tokens,
            position,
            allowed_identifiers,
            program.functions
        );
        if (position != expr_tokens.size()) {
            throw std::runtime_error("native parser prototype expected inline emit expression to consume the full line");
        }
    }

    static std::string parse_inline_emit_expression_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers,
        const std::vector<InlineFunctionDefinition>& functions
    ) {
        std::string left = parse_inline_emit_term_text(tokens, position, allowed_identifiers, functions);
        while (position < tokens.size()) {
            const std::string& kind = tokens[position].kind;
            if (kind != "PLUS" && kind != "MINUS") {
                break;
            }
            const std::string op = tokens[position].text;
            position += 1;
            std::string right = parse_inline_emit_term_text(tokens, position, allowed_identifiers, functions);
            left = "(" + left + " " + op + " " + right + ")";
        }
        return left;
    }

    static std::string parse_inline_emit_term_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers,
        const std::vector<InlineFunctionDefinition>& functions
    ) {
        std::string left = parse_inline_emit_unary_text(tokens, position, allowed_identifiers, functions);
        while (position < tokens.size()) {
            const std::string& kind = tokens[position].kind;
            if (kind != "STAR" && kind != "SLASH" && kind != "FLOOR_DIV" && kind != "PERCENT") {
                break;
            }
            const std::string op = tokens[position].text;
            position += 1;
            std::string right = parse_inline_emit_unary_text(tokens, position, allowed_identifiers, functions);
            left = "(" + left + " " + op + " " + right + ")";
        }
        return left;
    }

    static std::string parse_inline_emit_unary_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers,
        const std::vector<InlineFunctionDefinition>& functions
    ) {
        if (position < tokens.size() && tokens[position].kind == "MINUS") {
            position += 1;
            return "(-" + parse_inline_emit_unary_text(tokens, position, allowed_identifiers, functions) + ")";
        }
        return parse_inline_emit_primary_text(tokens, position, allowed_identifiers, functions);
    }

    static std::string parse_inline_emit_primary_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers,
        const std::vector<InlineFunctionDefinition>& functions
    ) {
        if (position >= tokens.size()) {
            throw std::runtime_error("native parser prototype expected inline emit-expression primary");
        }
        const Token& token = tokens[position];
        std::size_t function_arity = 0;
        if (
            token.kind == "IDENT" &&
            try_find_inline_function_arity(functions, token.text, function_arity) &&
            position + 1 < tokens.size() &&
            tokens[position + 1].kind == "LPAREN"
        ) {
            const std::string function_name = token.text;
            position += 2;
            std::vector<std::string> args;
            bool expect_arg = true;
            while (position < tokens.size()) {
                if (tokens[position].kind == "RPAREN") {
                    position += 1;
                    break;
                }
                if (!expect_arg) {
                    expect_kind(tokens, position, "COMMA");
                    position += 1;
                }
                args.push_back(
                    parse_inline_emit_expression_text(
                        tokens,
                        position,
                        allowed_identifiers,
                        functions
                    )
                );
                expect_arg = false;
            }
            if (args.size() != function_arity) {
                throw std::runtime_error("native parser prototype inline helper call arity must match declared parameters");
            }
            std::ostringstream out;
            out << function_name << "(";
            for (std::size_t i = 0; i < args.size(); ++i) {
                if (i > 0) {
                    out << ", ";
                }
                out << args[i];
            }
            out << ")";
            return out.str();
        }
        if (token.kind == "LPAREN") {
            position += 1;
            std::string inner = parse_inline_emit_expression_text(
                tokens,
                position,
                allowed_identifiers,
                functions
            );
            if (position >= tokens.size() || tokens[position].kind != "RPAREN") {
                throw std::runtime_error("native parser prototype expected closing ) in inline emit expression");
            }
            position += 1;
            return "(" + inner + ")";
        }
        return parse_numeric_primary_text(tokens, position, allowed_identifiers);
    }

    static std::string parse_emit_expression_text(const std::vector<Token>& tokens, std::size_t& position) {
        std::string left = parse_emit_term_text(tokens, position);
        while (position < tokens.size()) {
            const std::string& kind = tokens[position].kind;
            if (kind != "PLUS" && kind != "MINUS") {
                break;
            }
            const std::string op = tokens[position].text;
            position += 1;
            std::string right = parse_emit_term_text(tokens, position);
            left = "(" + left + " " + op + " " + right + ")";
        }
        return left;
    }

    static std::string parse_emit_term_text(const std::vector<Token>& tokens, std::size_t& position) {
        std::string left = parse_emit_unary_text(tokens, position);
        while (position < tokens.size()) {
            const std::string& kind = tokens[position].kind;
            if (kind != "STAR" && kind != "SLASH" && kind != "FLOOR_DIV" && kind != "PERCENT") {
                break;
            }
            const std::string op = tokens[position].text;
            position += 1;
            std::string right = parse_emit_unary_text(tokens, position);
            left = "(" + left + " " + op + " " + right + ")";
        }
        return left;
    }

    static std::string parse_emit_unary_text(const std::vector<Token>& tokens, std::size_t& position) {
        if (position < tokens.size() && tokens[position].kind == "MINUS") {
            position += 1;
            return "(-" + parse_emit_unary_text(tokens, position) + ")";
        }
        return parse_emit_primary_text(tokens, position);
    }

    static std::string parse_emit_primary_text(const std::vector<Token>& tokens, std::size_t& position) {
        if (position >= tokens.size()) {
            throw std::runtime_error("native parser prototype expected emit-expression primary");
        }
        const Token& token = tokens[position];
        if (token.kind == "NUMBER") {
            position += 1;
            return normalize_number_text(token.text);
        }
        if (token.kind == "STRING") {
            position += 1;
            return token.text;
        }
        if (token.kind == "LPAREN") {
            position += 1;
            std::string inner = parse_emit_expression_text(tokens, position);
            if (position >= tokens.size() || tokens[position].kind != "RPAREN") {
                throw std::runtime_error("native parser prototype expected closing ) in emit-expression");
            }
            position += 1;
            return "(" + inner + ")";
        }
        throw std::runtime_error("native parser prototype only supports number/string/parenthesized emit-expression primaries");
    }

    static bool is_allowed_ident(const std::string& text, const std::vector<std::string>& allowed_identifiers) {
        return std::find(allowed_identifiers.begin(), allowed_identifiers.end(), text) != allowed_identifiers.end();
    }

    static std::string parse_numeric_expression_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers
    ) {
        std::string left = parse_numeric_term_text(tokens, position, allowed_identifiers);
        while (position < tokens.size()) {
            const std::string& kind = tokens[position].kind;
            if (kind != "PLUS" && kind != "MINUS") {
                break;
            }
            const std::string op = tokens[position].text;
            position += 1;
            std::string right = parse_numeric_term_text(tokens, position, allowed_identifiers);
            left = "(" + left + " " + op + " " + right + ")";
        }
        return left;
    }

    static std::string parse_numeric_term_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers
    ) {
        std::string left = parse_numeric_unary_text(tokens, position, allowed_identifiers);
        while (position < tokens.size()) {
            const std::string& kind = tokens[position].kind;
            if (kind != "STAR" && kind != "SLASH" && kind != "FLOOR_DIV" && kind != "PERCENT") {
                break;
            }
            const std::string op = tokens[position].text;
            position += 1;
            std::string right = parse_numeric_unary_text(tokens, position, allowed_identifiers);
            left = "(" + left + " " + op + " " + right + ")";
        }
        return left;
    }

    static std::string parse_numeric_unary_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers
    ) {
        if (position < tokens.size() && tokens[position].kind == "MINUS") {
            position += 1;
            return "(-" + parse_numeric_unary_text(tokens, position, allowed_identifiers) + ")";
        }
        return parse_numeric_primary_text(tokens, position, allowed_identifiers);
    }

    static std::string parse_numeric_primary_text(
        const std::vector<Token>& tokens,
        std::size_t& position,
        const std::vector<std::string>& allowed_identifiers
    ) {
        if (position >= tokens.size()) {
            throw std::runtime_error("native parser prototype expected arithmetic primary");
        }
        const Token& token = tokens[position];
        if (token.kind == "NUMBER") {
            position += 1;
            return normalize_number_text(token.text);
        }
        if (token.kind == "IDENT") {
            if (!is_allowed_ident(token.text, allowed_identifiers)) {
                throw std::runtime_error("native parser prototype inline body used an undeclared identifier");
            }
            position += 1;
            return token.text;
        }
        if (token.kind == "LPAREN") {
            position += 1;
            std::string inner = parse_numeric_expression_text(tokens, position, allowed_identifiers);
            if (position >= tokens.size() || tokens[position].kind != "RPAREN") {
                throw std::runtime_error("native parser prototype expected closing ) in arithmetic expression");
            }
            position += 1;
            return "(" + inner + ")";
        }
        throw std::runtime_error("native parser prototype only supports arithmetic primaries from numbers, identifiers, and parentheses");
    }

    static void expect_kind(const std::vector<Token>& tokens, std::size_t index, const char* kind) {
        if (index >= tokens.size() || tokens[index].kind != kind) {
            throw std::runtime_error(std::string("native parser prototype expected token kind ") + kind);
        }
    }

    static double parse_number(const std::string& text) {
        return std::stod(text);
    }

    static void parse_hello_header(const std::vector<Token>& tokens, HelloProgram& program) {
        if (tokens.size() != 9) {
            throw std::runtime_error("native parser prototype expected hello-native function header shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "LPAREN");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "COLON");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "RPAREN");
        expect_kind(tokens, 6, "ARROW");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COLON");
        if (tokens[4].text != "num" || tokens[7].text != "num") {
            throw std::runtime_error("native parser prototype only supports num -> num hello-native signatures");
        }
        program.function_name = tokens[0].text;
        program.param_name = tokens[2].text;
    }

    static void parse_hello_body(const std::vector<Token>& tokens, HelloProgram& program) {
        if (tokens.size() != 3) {
            throw std::runtime_error("native parser prototype expected body shape 'x * 2'");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "STAR");
        expect_kind(tokens, 2, "NUMBER");
        if (tokens[0].text != program.param_name) {
            throw std::runtime_error("native parser prototype body must multiply the declared parameter");
        }
        program.multiplier = parse_number(tokens[2].text);
    }

    static void parse_hello_emit(const std::vector<Token>& tokens, HelloProgram& program) {
        if (tokens.size() != 5) {
            throw std::runtime_error("native parser prototype expected emit-call shape ':: twice(21)'");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "NUMBER");
        expect_kind(tokens, 4, "RPAREN");
        if (tokens[1].text != program.function_name) {
            throw std::runtime_error("native parser prototype emit call must target the declared function");
        }
        program.call_arg = parse_number(tokens[3].text);
    }

    static std::vector<double> parse_number_list(const std::vector<Token>& tokens, std::size_t start, std::size_t end) {
        std::vector<double> out;
        std::size_t pos = start;
        while (pos < end) {
            expect_kind(tokens, pos, "NUMBER");
            out.push_back(parse_number(tokens[pos].text));
            pos += 1;
            if (pos == end) {
                break;
            }
            expect_kind(tokens, pos, "COMMA");
            pos += 1;
        }
        return out;
    }

    static void parse_vector_binding(const std::vector<Token>& tokens, VectorBinding& binding) {
        if (tokens.size() < 10) {
            throw std::runtime_error("native parser prototype expected fixed vector binding shape");
        }
        expect_kind(tokens, 0, "LBRACKET");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "NUMBER");
        expect_kind(tokens, 4, "RBRACKET");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COLON");
        expect_kind(tokens, 7, "LBRACKET");
        expect_kind(tokens, tokens.size() - 1, "RBRACKET");
        if (tokens[1].text != "num") {
            throw std::runtime_error("native parser prototype only supports [num:N] vector bindings");
        }
        binding.name = tokens[5].text;
        binding.values = parse_number_list(tokens, 8, tokens.size() - 1);
        std::size_t declared_extent = static_cast<std::size_t>(parse_number(tokens[3].text));
        if (declared_extent != binding.values.size()) {
            throw std::runtime_error("native parser prototype vector binding extent does not match literal length");
        }
    }

    static void parse_vector_header(const std::vector<Token>& tokens, VectorProgram& program) {
        if (tokens.size() != 25) {
            throw std::runtime_error("native parser prototype expected vectors-native function header shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "LPAREN");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "COLON");
        expect_kind(tokens, 4, "LBRACKET");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COLON");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "RBRACKET");
        expect_kind(tokens, 9, "COMMA");
        expect_kind(tokens, 10, "IDENT");
        expect_kind(tokens, 11, "COLON");
        expect_kind(tokens, 12, "LBRACKET");
        expect_kind(tokens, 13, "IDENT");
        expect_kind(tokens, 14, "COLON");
        expect_kind(tokens, 15, "IDENT");
        expect_kind(tokens, 16, "RBRACKET");
        expect_kind(tokens, 17, "RPAREN");
        expect_kind(tokens, 18, "ARROW");
        expect_kind(tokens, 19, "LBRACKET");
        expect_kind(tokens, 20, "IDENT");
        expect_kind(tokens, 21, "COLON");
        expect_kind(tokens, 22, "IDENT");
        expect_kind(tokens, 23, "RBRACKET");
        expect_kind(tokens, 24, "COLON");
        if (tokens[5].text != "num" || tokens[13].text != "num" || tokens[20].text != "num") {
            throw std::runtime_error("native parser prototype only supports num vectors in vectors-native signatures");
        }
        if (tokens[7].text != "n" || tokens[15].text != "n" || tokens[22].text != "n") {
            throw std::runtime_error("native parser prototype only supports shared extent symbol n");
        }
        program.function_name = tokens[0].text;
    }

    static void parse_vector_body(const std::vector<Token>& tokens, VectorProgram& program) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected vectors-native body shape '(x + y) * 0.5'");
        }
        expect_kind(tokens, 0, "LPAREN");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "PLUS");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "RPAREN");
        expect_kind(tokens, 5, "STAR");
        expect_kind(tokens, 6, "NUMBER");
        program.left_param_name = tokens[1].text;
        program.right_param_name = tokens[3].text;
        program.scale = parse_number(tokens[6].text);
    }

    static void parse_vector_emit(const std::vector<Token>& tokens, VectorProgram& program) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected vectors-native emit-call shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COMMA");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "RPAREN");
        program.function_name = tokens[1].text;
        program.emit_left_name = tokens[3].text;
        program.emit_right_name = tokens[5].text;
    }

    static void validate_vector_program(VectorProgram& program) {
        if (program.left_binding.values.size() != program.right_binding.values.size()) {
            throw std::runtime_error("native parser prototype requires same-length fixed vectors");
        }
        program.extent = program.left_binding.values.size();
        if (program.left_param_name.empty() || program.right_param_name.empty()) {
            throw std::runtime_error("native parser prototype expected vectors-native parameter names");
        }
        if (program.emit_left_name != program.left_binding.name || program.emit_right_name != program.right_binding.name) {
            throw std::runtime_error("native parser prototype emit call must target the declared fixed vectors");
        }
    }

    static void parse_numeric_binding(const std::vector<Token>& tokens, NumericBinding& binding) {
        if (tokens.size() < 5) {
            throw std::runtime_error("native parser prototype expected numeric-native binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LBRACKET");
        expect_kind(tokens, tokens.size() - 1, "RBRACKET");
        binding.name = tokens[0].text;
        binding.values = parse_number_list(tokens, 3, tokens.size() - 1);
        if (binding.values.empty()) {
            throw std::runtime_error("native parser prototype numeric-native bindings must be non-empty");
        }
    }

    static void parse_numeric_emit_sin(const std::vector<Token>& tokens) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected ':: math.sin(0)' shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "NUMBER");
        expect_kind(tokens, 6, "RPAREN");
        if (tokens[1].text != "math" || tokens[3].text != "sin" || parse_number(tokens[5].text) != 0.0) {
            throw std::runtime_error("native parser prototype only supports ':: math.sin(0)' in numeric-native");
        }
    }

    static void parse_numeric_emit_pi(const std::vector<Token>& tokens) {
        if (tokens.size() != 4) {
            throw std::runtime_error("native parser prototype expected ':: math.pi' shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        if (tokens[1].text != "math" || tokens[3].text != "pi") {
            throw std::runtime_error("native parser prototype only supports ':: math.pi' in numeric-native");
        }
    }

    static void parse_numeric_emit_mean(const std::vector<Token>& tokens, const NumericProgram& program) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected ':: stat.mean(xs)' shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "RPAREN");
        if (tokens[1].text != "stat" || tokens[3].text != "mean" || tokens[5].text != program.xs_binding.name) {
            throw std::runtime_error("native parser prototype only supports ':: stat.mean(xs)' in numeric-native");
        }
    }

    static void parse_numeric_emit_normalize(const std::vector<Token>& tokens, const NumericProgram& program) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected ':: stat.normalize(xs)' shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "RPAREN");
        if (tokens[1].text != "stat" || tokens[3].text != "normalize" || tokens[5].text != program.xs_binding.name) {
            throw std::runtime_error("native parser prototype only supports ':: stat.normalize(xs)' in numeric-native");
        }
    }

    static void parse_numeric_emit_correlation(const std::vector<Token>& tokens, const NumericProgram& program) {
        if (tokens.size() != 9) {
            throw std::runtime_error("native parser prototype expected ':: stat.correlation(xs, ys)' shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "RPAREN");
        if (
            tokens[1].text != "stat" ||
            tokens[3].text != "correlation" ||
            tokens[5].text != program.xs_binding.name ||
            tokens[7].text != program.ys_binding.name
        ) {
            throw std::runtime_error("native parser prototype only supports ':: stat.correlation(xs, ys)' in numeric-native");
        }
    }

    static void validate_numeric_program(const NumericProgram& program) {
        if (program.xs_binding.values.size() != program.ys_binding.values.size()) {
            throw std::runtime_error("native parser prototype numeric-native bindings must have matching extents");
        }
    }

    static void parse_named_record_typedef(const std::vector<Token>& tokens, NamedRecordProgram& program) {
        if (tokens.size() != 11) {
            throw std::runtime_error("native parser prototype expected named-record typedef shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COLON");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COLON");
        expect_kind(tokens, 9, "IDENT");
        expect_kind(tokens, 10, "RPAREN");
        if (tokens[5].text != "num" || tokens[9].text != "num") {
            throw std::runtime_error("native parser prototype only supports named Point:num,num records");
        }
        program.type_name = tokens[0].text;
        program.first_field_name = tokens[3].text;
        program.second_field_name = tokens[7].text;
    }

    static void parse_named_record_header(const std::vector<Token>& tokens, NamedRecordProgram& program) {
        if (tokens.size() != 17) {
            throw std::runtime_error("native parser prototype expected named-record function header shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "LPAREN");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "COLON");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "COMMA");
        expect_kind(tokens, 6, "IDENT");
        expect_kind(tokens, 7, "COLON");
        expect_kind(tokens, 8, "IDENT");
        expect_kind(tokens, 9, "COMMA");
        expect_kind(tokens, 10, "IDENT");
        expect_kind(tokens, 11, "COLON");
        expect_kind(tokens, 12, "IDENT");
        expect_kind(tokens, 13, "RPAREN");
        expect_kind(tokens, 14, "ARROW");
        expect_kind(tokens, 15, "IDENT");
        expect_kind(tokens, 16, "COLON");
        if (tokens[4].text != program.type_name || tokens[8].text != "num" || tokens[12].text != "num" || tokens[15].text != program.type_name) {
            throw std::runtime_error("native parser prototype only supports move(Point, num, num) -> Point");
        }
        program.move_function_name = tokens[0].text;
        program.param_name = tokens[2].text;
        program.delta_x_name = tokens[6].text;
        program.delta_y_name = tokens[10].text;
    }

    static void parse_named_record_body(const std::vector<Token>& tokens, NamedRecordProgram& program) {
        if (tokens.size() != 17) {
            throw std::runtime_error("native parser prototype expected named-record body shape");
        }
        expect_kind(tokens, 0, "LPAREN");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "DOT");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "PLUS");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COMMA");
        expect_kind(tokens, 9, "IDENT");
        expect_kind(tokens, 10, "COLON");
        expect_kind(tokens, 11, "IDENT");
        expect_kind(tokens, 12, "DOT");
        expect_kind(tokens, 13, "IDENT");
        expect_kind(tokens, 14, "PLUS");
        expect_kind(tokens, 15, "IDENT");
        expect_kind(tokens, 16, "RPAREN");
        if (
            tokens[1].text != program.first_field_name ||
            tokens[3].text != program.param_name ||
            tokens[5].text != program.first_field_name ||
            tokens[7].text != program.delta_x_name ||
            tokens[9].text != program.second_field_name ||
            tokens[11].text != program.param_name ||
            tokens[13].text != program.second_field_name ||
            tokens[15].text != program.delta_y_name
        ) {
            throw std::runtime_error("native parser prototype only supports named-record body '(x:p.x + dx, y:p.y + dy)'");
        }
    }

    static void parse_named_record_base_binding(const std::vector<Token>& tokens, NamedRecordProgram& program) {
        if (tokens.size() != 12) {
            throw std::runtime_error("native parser prototype expected named-record base binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "LPAREN");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "COLON");
        expect_kind(tokens, 6, "NUMBER");
        expect_kind(tokens, 7, "COMMA");
        expect_kind(tokens, 8, "IDENT");
        expect_kind(tokens, 9, "COLON");
        expect_kind(tokens, 10, "NUMBER");
        expect_kind(tokens, 11, "RPAREN");
        if (tokens[0].text != program.type_name || tokens[4].text != program.first_field_name || tokens[8].text != program.second_field_name) {
            throw std::runtime_error("native parser prototype only supports typed Point base literal binding");
        }
        program.base_name = tokens[1].text;
        program.base_first_value = parse_number(tokens[6].text);
        program.base_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_shifted_binding(const std::vector<Token>& tokens, NamedRecordProgram& program) {
        if (tokens.size() != 11) {
            throw std::runtime_error("native parser prototype expected named-record shifted binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "NUMBER");
        expect_kind(tokens, 8, "COMMA");
        expect_kind(tokens, 9, "NUMBER");
        expect_kind(tokens, 10, "RPAREN");
        if (tokens[0].text != program.type_name || tokens[3].text != program.move_function_name || tokens[5].text != program.base_name) {
            throw std::runtime_error("native parser prototype only supports Point shifted: move(base, 3, 4)");
        }
        program.shifted_name = tokens[1].text;
        program.shift_x_value = parse_number(tokens[7].text);
        program.shift_y_value = parse_number(tokens[9].text);
    }

    static void parse_named_record_emit_first_field(const std::vector<Token>& tokens, const NamedRecordProgram& program) {
        if (tokens.size() != 4) {
            throw std::runtime_error("native parser prototype expected named-record emit field shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        if (tokens[1].text != program.shifted_name || tokens[3].text != program.first_field_name) {
            throw std::runtime_error("native parser prototype only supports ':: shifted.x'");
        }
    }

    static void parse_named_record_emit_record(const std::vector<Token>& tokens, const NamedRecordProgram& program) {
        if (tokens.size() != 2) {
            throw std::runtime_error("native parser prototype expected named-record emit record shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        if (tokens[1].text != program.shifted_name) {
            throw std::runtime_error("native parser prototype only supports ':: shifted'");
        }
    }

    static void validate_named_record_program(const NamedRecordProgram& program) {
        if (program.type_name.empty() || program.move_function_name.empty() || program.base_name.empty() || program.shifted_name.empty()) {
            throw std::runtime_error("native parser prototype expected named-record program identifiers");
        }
    }

    static void parse_nested_named_record_point_typedef(const std::vector<Token>& tokens, NestedNamedRecordProgram& program) {
        if (tokens.size() != 11) {
            throw std::runtime_error("native parser prototype expected nested Point typedef shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COLON");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COLON");
        expect_kind(tokens, 9, "IDENT");
        expect_kind(tokens, 10, "RPAREN");
        if (tokens[5].text != "num" || tokens[9].text != "num") {
            throw std::runtime_error("native parser prototype only supports Point:num,num nested records");
        }
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_nested_named_record_box_typedef(const std::vector<Token>& tokens, NestedNamedRecordProgram& program) {
        if (tokens.size() != 11) {
            throw std::runtime_error("native parser prototype expected nested Box typedef shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COLON");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COLON");
        expect_kind(tokens, 9, "IDENT");
        expect_kind(tokens, 10, "RPAREN");
        if (tokens[5].text != program.point_type_name || tokens[9].text != program.point_type_name) {
            throw std::runtime_error("native parser prototype only supports Box fields referencing Point");
        }
        program.box_type_name = tokens[0].text;
        program.box_origin_field_name = tokens[3].text;
        program.box_size_field_name = tokens[7].text;
    }

    static void parse_nested_named_record_header(const std::vector<Token>& tokens, NestedNamedRecordProgram& program) {
        if (tokens.size() != 17) {
            throw std::runtime_error("native parser prototype expected nested named-record header shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "LPAREN");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "COLON");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "COMMA");
        expect_kind(tokens, 6, "IDENT");
        expect_kind(tokens, 7, "COLON");
        expect_kind(tokens, 8, "IDENT");
        expect_kind(tokens, 9, "COMMA");
        expect_kind(tokens, 10, "IDENT");
        expect_kind(tokens, 11, "COLON");
        expect_kind(tokens, 12, "IDENT");
        expect_kind(tokens, 13, "RPAREN");
        expect_kind(tokens, 14, "ARROW");
        expect_kind(tokens, 15, "IDENT");
        expect_kind(tokens, 16, "COLON");
        if (
            tokens[4].text != program.box_type_name ||
            tokens[8].text != "num" ||
            tokens[12].text != "num" ||
            tokens[15].text != program.box_type_name
        ) {
            throw std::runtime_error("native parser prototype only supports translate(box:Box, dx:num, dy:num)");
        }
        program.translate_function_name = tokens[0].text;
        program.param_name = tokens[2].text;
        program.delta_x_name = tokens[6].text;
        program.delta_y_name = tokens[10].text;
    }

    static void parse_nested_named_record_body(const std::vector<Token>& tokens, NestedNamedRecordProgram& program) {
        if (tokens.size() != 31) {
            throw std::runtime_error("native parser prototype expected nested named-record body shape");
        }
        expect_kind(tokens, 0, "LPAREN");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "LPAREN");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "COLON");
        expect_kind(tokens, 6, "IDENT");
        expect_kind(tokens, 7, "DOT");
        expect_kind(tokens, 8, "IDENT");
        expect_kind(tokens, 9, "DOT");
        expect_kind(tokens, 10, "IDENT");
        expect_kind(tokens, 11, "PLUS");
        expect_kind(tokens, 12, "IDENT");
        expect_kind(tokens, 13, "COMMA");
        expect_kind(tokens, 14, "IDENT");
        expect_kind(tokens, 15, "COLON");
        expect_kind(tokens, 16, "IDENT");
        expect_kind(tokens, 17, "DOT");
        expect_kind(tokens, 18, "IDENT");
        expect_kind(tokens, 19, "DOT");
        expect_kind(tokens, 20, "IDENT");
        expect_kind(tokens, 21, "PLUS");
        expect_kind(tokens, 22, "IDENT");
        expect_kind(tokens, 23, "RPAREN");
        expect_kind(tokens, 24, "COMMA");
        expect_kind(tokens, 25, "IDENT");
        expect_kind(tokens, 26, "COLON");
        expect_kind(tokens, 27, "IDENT");
        expect_kind(tokens, 28, "DOT");
        expect_kind(tokens, 29, "IDENT");
        expect_kind(tokens, 30, "RPAREN");
        if (
            tokens[1].text != program.box_origin_field_name ||
            tokens[4].text != program.point_first_field_name ||
            tokens[8].text != program.box_origin_field_name ||
            tokens[10].text != program.point_first_field_name ||
            tokens[12].text != program.delta_x_name ||
            tokens[14].text != program.point_second_field_name ||
            tokens[18].text != program.box_origin_field_name ||
            tokens[20].text != program.point_second_field_name ||
            tokens[22].text != program.delta_y_name ||
            tokens[25].text != program.box_size_field_name ||
            tokens[29].text != program.box_size_field_name ||
            tokens[6].text != program.param_name ||
            tokens[16].text != program.param_name ||
            tokens[27].text != program.param_name
        ) {
            throw std::runtime_error("native parser prototype only supports the exact nested named-record body shape");
        }
    }

    static void parse_nested_named_record_base_binding(const std::vector<Token>& tokens, NestedNamedRecordProgram& program) {
        if (tokens.size() != 28) {
            throw std::runtime_error("native parser prototype expected nested named-record base binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "LPAREN");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "COLON");
        expect_kind(tokens, 6, "LPAREN");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COLON");
        expect_kind(tokens, 9, "NUMBER");
        expect_kind(tokens, 10, "COMMA");
        expect_kind(tokens, 11, "IDENT");
        expect_kind(tokens, 12, "COLON");
        expect_kind(tokens, 13, "NUMBER");
        expect_kind(tokens, 14, "RPAREN");
        expect_kind(tokens, 15, "COMMA");
        expect_kind(tokens, 16, "IDENT");
        expect_kind(tokens, 17, "COLON");
        expect_kind(tokens, 18, "LPAREN");
        expect_kind(tokens, 19, "IDENT");
        expect_kind(tokens, 20, "COLON");
        expect_kind(tokens, 21, "NUMBER");
        expect_kind(tokens, 22, "COMMA");
        expect_kind(tokens, 23, "IDENT");
        expect_kind(tokens, 24, "COLON");
        expect_kind(tokens, 25, "NUMBER");
        expect_kind(tokens, 26, "RPAREN");
        expect_kind(tokens, 27, "RPAREN");
        if (tokens[0].text != program.box_type_name || tokens[4].text != program.box_origin_field_name || tokens[16].text != program.box_size_field_name) {
            throw std::runtime_error("native parser prototype only supports typed Box base binding");
        }
        if (
            tokens[7].text != program.point_first_field_name ||
            tokens[11].text != program.point_second_field_name ||
            tokens[19].text != program.point_first_field_name ||
            tokens[23].text != program.point_second_field_name
        ) {
            throw std::runtime_error("native parser prototype only supports Point-valued Box fields");
        }
        program.base_name = tokens[1].text;
        program.base_origin_first_value = parse_number(tokens[9].text);
        program.base_origin_second_value = parse_number(tokens[13].text);
        program.base_size_first_value = parse_number(tokens[21].text);
        program.base_size_second_value = parse_number(tokens[25].text);
    }

    static void parse_nested_named_record_moved_binding(const std::vector<Token>& tokens, NestedNamedRecordProgram& program) {
        if (tokens.size() != 11) {
            throw std::runtime_error("native parser prototype expected nested named-record moved binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "NUMBER");
        expect_kind(tokens, 8, "COMMA");
        expect_kind(tokens, 9, "NUMBER");
        expect_kind(tokens, 10, "RPAREN");
        if (tokens[0].text != program.box_type_name || tokens[3].text != program.translate_function_name || tokens[5].text != program.base_name) {
            throw std::runtime_error("native parser prototype only supports Box moved: translate(base, 3, 4)");
        }
        program.moved_name = tokens[1].text;
        program.shift_x_value = parse_number(tokens[7].text);
        program.shift_y_value = parse_number(tokens[9].text);
    }

    static void parse_nested_named_record_emit_origin_field(const std::vector<Token>& tokens, const NestedNamedRecordProgram& program) {
        if (tokens.size() != 6) {
            throw std::runtime_error("native parser prototype expected nested named-record field emit shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "DOT");
        expect_kind(tokens, 5, "IDENT");
        if (
            tokens[1].text != program.moved_name ||
            tokens[3].text != program.box_origin_field_name ||
            tokens[5].text != program.point_first_field_name
        ) {
            throw std::runtime_error("native parser prototype only supports ':: moved.origin.x'");
        }
    }

    static void parse_nested_named_record_emit_record(const std::vector<Token>& tokens, const NestedNamedRecordProgram& program) {
        if (tokens.size() != 2) {
            throw std::runtime_error("native parser prototype expected nested named-record emit record shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        if (tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype only supports ':: moved'");
        }
    }

    static void parse_named_record_collections_typedef(const std::vector<Token>& tokens, NamedRecordCollectionsProgram& program) {
        if (tokens.size() != 21) {
            throw std::runtime_error("native parser prototype expected named-record-collections typedef shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COLON");
        expect_kind(tokens, 5, "LBRACKET");
        expect_kind(tokens, 6, "IDENT");
        expect_kind(tokens, 7, "COLON");
        expect_kind(tokens, 8, "NUMBER");
        expect_kind(tokens, 9, "RBRACKET");
        expect_kind(tokens, 10, "COMMA");
        expect_kind(tokens, 11, "IDENT");
        expect_kind(tokens, 12, "COLON");
        expect_kind(tokens, 13, "LBRACE");
        expect_kind(tokens, 14, "IDENT");
        expect_kind(tokens, 15, "RBRACE");
        expect_kind(tokens, 16, "COMMA");
        if (tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num") {
            throw std::runtime_error("native parser prototype only supports named-record-collections [num:2] and {num} fields");
        }
        if (tokens[17].kind != "IDENT" || tokens[18].kind != "COLON" || tokens[19].kind != "IDENT" || tokens[20].kind != "RPAREN") {
            throw std::runtime_error("native parser prototype expected trailing total:num field in named-record-collections typedef");
        }
        if (tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports numeric totals in named-record-collections typedef");
        }
        program.type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_collections_header(const std::vector<Token>& tokens, NamedRecordCollectionsProgram& program) {
        if (tokens.size() != 23) {
            throw std::runtime_error("native parser prototype expected named-record-collections function header shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "LPAREN");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "COLON");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "COMMA");
        expect_kind(tokens, 6, "IDENT");
        expect_kind(tokens, 7, "COLON");
        expect_kind(tokens, 8, "LBRACKET");
        expect_kind(tokens, 9, "IDENT");
        expect_kind(tokens, 10, "COLON");
        expect_kind(tokens, 11, "NUMBER");
        expect_kind(tokens, 12, "RBRACKET");
        expect_kind(tokens, 13, "COMMA");
        expect_kind(tokens, 14, "IDENT");
        expect_kind(tokens, 15, "COLON");
        expect_kind(tokens, 16, "LBRACE");
        expect_kind(tokens, 17, "IDENT");
        expect_kind(tokens, 18, "RBRACE");
        expect_kind(tokens, 19, "RPAREN");
        expect_kind(tokens, 20, "ARROW");
        expect_kind(tokens, 21, "IDENT");
        expect_kind(tokens, 22, "COLON");
        if (
            tokens[4].text != program.type_name ||
            tokens[9].text != "num" ||
            tokens[11].text != "2" ||
            tokens[17].text != "num" ||
            tokens[21].text != program.type_name
        ) {
            throw std::runtime_error("native parser prototype expected narrow named-record-collections signature");
        }
        program.function_name = tokens[0].text;
        program.param_name = tokens[2].text;
        program.extra_name = tokens[6].text;
        program.delta_name = tokens[14].text;
    }

    static void parse_named_record_collections_body(const std::vector<Token>& tokens, const NamedRecordCollectionsProgram& program) {
        if (tokens.size() != 25) {
            throw std::runtime_error("native parser prototype expected named-record-collections body shape");
        }
        expect_kind(tokens, 0, "LPAREN");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "DOT");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "PLUS");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COMMA");
        expect_kind(tokens, 9, "IDENT");
        expect_kind(tokens, 10, "COLON");
        expect_kind(tokens, 11, "IDENT");
        expect_kind(tokens, 12, "DOT");
        expect_kind(tokens, 13, "IDENT");
        expect_kind(tokens, 14, "PLUS");
        expect_kind(tokens, 15, "IDENT");
        expect_kind(tokens, 16, "COMMA");
        expect_kind(tokens, 17, "IDENT");
        expect_kind(tokens, 18, "COLON");
        expect_kind(tokens, 19, "IDENT");
        expect_kind(tokens, 20, "DOT");
        if (
            tokens[20].kind != "DOT" ||
            tokens[21].kind != "IDENT" ||
            tokens[22].kind != "PLUS" ||
            tokens[23].kind != "NUMBER" ||
            tokens[24].kind != "RPAREN"
        ) {
            throw std::runtime_error("native parser prototype expected trailing total update in named-record-collections body");
        }
        if (
            tokens[1].text != program.vector_field_name ||
            tokens[3].text != program.param_name ||
            tokens[5].text != program.vector_field_name ||
            tokens[7].text != program.extra_name ||
            tokens[9].text != program.multiset_field_name ||
            tokens[11].text != program.param_name ||
            tokens[13].text != program.multiset_field_name ||
            tokens[15].text != program.delta_name ||
            tokens[17].text != program.total_field_name ||
            tokens[19].text != program.param_name ||
            tokens[21].text != program.total_field_name ||
            tokens[23].text != "1"
        ) {
            throw std::runtime_error("native parser prototype expected exact named-record-collections body");
        }
    }

    static void parse_named_record_collections_base_binding(const std::vector<Token>& tokens, NamedRecordCollectionsProgram& program) {
        if (tokens.size() != 24) {
            throw std::runtime_error("native parser prototype expected named-record-collections base binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "LPAREN");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "COLON");
        expect_kind(tokens, 6, "LBRACKET");
        expect_kind(tokens, 7, "NUMBER");
        expect_kind(tokens, 8, "COMMA");
        expect_kind(tokens, 9, "NUMBER");
        expect_kind(tokens, 10, "RBRACKET");
        expect_kind(tokens, 11, "COMMA");
        expect_kind(tokens, 12, "IDENT");
        expect_kind(tokens, 13, "COLON");
        expect_kind(tokens, 14, "LBRACE");
        expect_kind(tokens, 15, "NUMBER");
        expect_kind(tokens, 16, "COLON");
        expect_kind(tokens, 17, "NUMBER");
        expect_kind(tokens, 18, "RBRACE");
        expect_kind(tokens, 19, "COMMA");
        expect_kind(tokens, 20, "IDENT");
        expect_kind(tokens, 21, "COLON");
        expect_kind(tokens, 22, "NUMBER");
        if (tokens[23].kind != "RPAREN") {
            throw std::runtime_error("native parser prototype expected closing paren in named-record-collections base binding");
        }
        if (
            tokens[0].text != program.type_name ||
            tokens[4].text != program.vector_field_name ||
            tokens[12].text != program.multiset_field_name ||
            tokens[20].text != program.total_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact named-record-collections base binding field order");
        }
        program.base_name = tokens[1].text;
        program.base_vector_first_value = parse_number(tokens[7].text);
        program.base_vector_second_value = parse_number(tokens[9].text);
        program.base_multiset_key = parse_number(tokens[15].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[17].text));
        program.base_total_value = parse_number(tokens[22].text);
    }

    static void parse_named_record_collections_moved_binding(const std::vector<Token>& tokens, NamedRecordCollectionsProgram& program) {
        if (tokens.size() != 19) {
            throw std::runtime_error("native parser prototype expected named-record-collections moved binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "COLON");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "LBRACKET");
        expect_kind(tokens, 8, "NUMBER");
        expect_kind(tokens, 9, "COMMA");
        expect_kind(tokens, 10, "NUMBER");
        expect_kind(tokens, 11, "RBRACKET");
        expect_kind(tokens, 12, "COMMA");
        expect_kind(tokens, 13, "LBRACE");
        expect_kind(tokens, 14, "NUMBER");
        expect_kind(tokens, 15, "COLON");
        expect_kind(tokens, 16, "NUMBER");
        if (tokens[17].kind != "RBRACE" || tokens[18].kind != "RPAREN") {
            throw std::runtime_error("native parser prototype expected named-record-collections moved binding tail");
        }
        if (
            tokens[0].text != program.type_name ||
            tokens[3].text != program.function_name ||
            tokens[5].text != program.base_name
        ) {
            throw std::runtime_error("native parser prototype expected exact named-record-collections moved binding");
        }
        program.moved_name = tokens[1].text;
        program.moved_vector_first_value = parse_number(tokens[8].text);
        program.moved_vector_second_value = parse_number(tokens[10].text);
        program.moved_multiset_key = parse_number(tokens[14].text);
        program.moved_multiset_count = static_cast<long long>(parse_number(tokens[16].text));
    }

    static void parse_named_record_collections_emit_vector(const std::vector<Token>& tokens, const NamedRecordCollectionsProgram& program) {
        if (tokens.size() != 4) {
            throw std::runtime_error("native parser prototype expected named-record-collections vector emit shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        if (tokens[1].text != program.moved_name || tokens[3].text != program.vector_field_name) {
            throw std::runtime_error("native parser prototype only supports ':: moved.<vector field>'");
        }
    }

    static void parse_named_record_collections_emit_multiset(const std::vector<Token>& tokens, const NamedRecordCollectionsProgram& program) {
        if (tokens.size() != 4) {
            throw std::runtime_error("native parser prototype expected named-record-collections multiset emit shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "DOT");
        expect_kind(tokens, 3, "IDENT");
        if (tokens[1].text != program.moved_name || tokens[3].text != program.multiset_field_name) {
            throw std::runtime_error("native parser prototype only supports ':: moved.<multiset field>'");
        }
    }

    static void parse_named_record_collections_emit_record(const std::vector<Token>& tokens, const NamedRecordCollectionsProgram& program) {
        if (tokens.size() != 2) {
            throw std::runtime_error("native parser prototype expected named-record-collections record emit shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        if (tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype only supports ':: moved' for named-record-collections");
        }
    }

    static void parse_records_header(const std::vector<Token>& tokens, RecordsProgram& program) {
        if (tokens.size() != 59) {
            throw std::runtime_error("native parser prototype expected records-native function header shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "LPAREN");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "COLON");
        expect_kind(tokens, 4, "LPAREN");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COLON");
        expect_kind(tokens, 7, "LBRACKET");
        expect_kind(tokens, 8, "IDENT");
        expect_kind(tokens, 9, "COLON");
        expect_kind(tokens, 10, "NUMBER");
        expect_kind(tokens, 11, "RBRACKET");
        expect_kind(tokens, 12, "COMMA");
        expect_kind(tokens, 13, "IDENT");
        expect_kind(tokens, 14, "COLON");
        expect_kind(tokens, 15, "LBRACE");
        expect_kind(tokens, 16, "IDENT");
        expect_kind(tokens, 17, "RBRACE");
        expect_kind(tokens, 18, "COMMA");
        expect_kind(tokens, 19, "IDENT");
        expect_kind(tokens, 20, "COLON");
        expect_kind(tokens, 21, "IDENT");
        expect_kind(tokens, 22, "RPAREN");
        expect_kind(tokens, 23, "COMMA");
        expect_kind(tokens, 24, "IDENT");
        expect_kind(tokens, 25, "COLON");
        expect_kind(tokens, 26, "LBRACKET");
        expect_kind(tokens, 27, "IDENT");
        expect_kind(tokens, 28, "COLON");
        expect_kind(tokens, 29, "NUMBER");
        expect_kind(tokens, 30, "RBRACKET");
        expect_kind(tokens, 31, "COMMA");
        expect_kind(tokens, 32, "IDENT");
        expect_kind(tokens, 33, "COLON");
        expect_kind(tokens, 34, "LBRACE");
        expect_kind(tokens, 35, "IDENT");
        expect_kind(tokens, 36, "RBRACE");
        expect_kind(tokens, 37, "RPAREN");
        expect_kind(tokens, 38, "ARROW");
        expect_kind(tokens, 39, "LPAREN");
        expect_kind(tokens, 40, "IDENT");
        expect_kind(tokens, 41, "COLON");
        expect_kind(tokens, 42, "LBRACKET");
        expect_kind(tokens, 43, "IDENT");
        expect_kind(tokens, 44, "COLON");
        expect_kind(tokens, 45, "NUMBER");
        expect_kind(tokens, 46, "RBRACKET");
        expect_kind(tokens, 47, "COMMA");
        expect_kind(tokens, 48, "IDENT");
        expect_kind(tokens, 49, "COLON");
        expect_kind(tokens, 50, "LBRACE");
        expect_kind(tokens, 51, "IDENT");
        expect_kind(tokens, 52, "RBRACE");
        expect_kind(tokens, 53, "COMMA");
        expect_kind(tokens, 54, "IDENT");
        expect_kind(tokens, 55, "COLON");
        expect_kind(tokens, 56, "IDENT");
        expect_kind(tokens, 57, "RPAREN");
        expect_kind(tokens, 58, "COLON");
        if (
            tokens[8].text != "num" ||
            tokens[10].text != "2" ||
            tokens[16].text != "num" ||
            tokens[21].text != "num" ||
            tokens[27].text != "num" ||
            tokens[29].text != "2" ||
            tokens[35].text != "num" ||
            tokens[43].text != "num" ||
            tokens[45].text != "2" ||
            tokens[51].text != "num" ||
            tokens[56].text != "num"
        ) {
            throw std::runtime_error("native parser prototype only supports exact records-native [num:2], {num}, total:num shape");
        }
        if (
            tokens[5].text != tokens[40].text ||
            tokens[13].text != tokens[48].text ||
            tokens[19].text != tokens[54].text
        ) {
            throw std::runtime_error("native parser prototype expected records-native return fields to match parameter fields");
        }
        program.function_name = tokens[0].text;
        program.param_name = tokens[2].text;
        program.vector_field_name = tokens[5].text;
        program.multiset_field_name = tokens[13].text;
        program.total_field_name = tokens[19].text;
        program.extra_name = tokens[24].text;
        program.delta_name = tokens[32].text;
    }

    static void parse_records_body_start(const std::vector<Token>& tokens) {
        if (tokens.size() != 1) {
            throw std::runtime_error("native parser prototype expected records-native body start shape");
        }
        expect_kind(tokens, 0, "LPAREN");
    }

    static void parse_records_body_pts_line(const std::vector<Token>& tokens, const RecordsProgram& program) {
        if (tokens.size() != 8) {
            throw std::runtime_error("native parser prototype expected records-native pts line shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "DOT");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "PLUS");
        expect_kind(tokens, 6, "IDENT");
        expect_kind(tokens, 7, "COMMA");
        if (
            tokens[0].text != program.vector_field_name ||
            tokens[2].text != program.param_name ||
            tokens[4].text != program.vector_field_name ||
            tokens[6].text != program.extra_name
        ) {
            throw std::runtime_error("native parser prototype expected exact records-native pts update");
        }
    }

    static void parse_records_body_bag_line(const std::vector<Token>& tokens, const RecordsProgram& program) {
        if (tokens.size() != 8) {
            throw std::runtime_error("native parser prototype expected records-native bag line shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "DOT");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "PLUS");
        expect_kind(tokens, 6, "IDENT");
        expect_kind(tokens, 7, "COMMA");
        if (
            tokens[0].text != program.multiset_field_name ||
            tokens[2].text != program.param_name ||
            tokens[4].text != program.multiset_field_name ||
            tokens[6].text != program.delta_name
        ) {
            throw std::runtime_error("native parser prototype expected exact records-native bag update");
        }
    }

    static void parse_records_body_total_line(const std::vector<Token>& tokens, const RecordsProgram& program) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected records-native total line shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "DOT");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "PLUS");
        expect_kind(tokens, 6, "NUMBER");
        if (
            tokens[0].text != program.total_field_name ||
            tokens[2].text != program.param_name ||
            tokens[4].text != program.total_field_name ||
            tokens[6].text != "2"
        ) {
            throw std::runtime_error("native parser prototype expected exact records-native total update");
        }
    }

    static void parse_records_body_end(const std::vector<Token>& tokens) {
        if (tokens.size() != 1) {
            throw std::runtime_error("native parser prototype expected records-native body end shape");
        }
        expect_kind(tokens, 0, "RPAREN");
    }

    static void parse_records_base_binding(const std::vector<Token>& tokens, RecordsProgram& program) {
        if (tokens.size() != 27) {
            throw std::runtime_error("native parser prototype expected records-native base binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COLON");
        expect_kind(tokens, 5, "LBRACKET");
        expect_kind(tokens, 6, "NUMBER");
        expect_kind(tokens, 7, "COMMA");
        expect_kind(tokens, 8, "NUMBER");
        expect_kind(tokens, 9, "RBRACKET");
        expect_kind(tokens, 10, "COMMA");
        expect_kind(tokens, 11, "IDENT");
        expect_kind(tokens, 12, "COLON");
        expect_kind(tokens, 13, "LBRACE");
        expect_kind(tokens, 14, "NUMBER");
        expect_kind(tokens, 15, "COLON");
        expect_kind(tokens, 16, "NUMBER");
        expect_kind(tokens, 17, "COMMA");
        expect_kind(tokens, 18, "NUMBER");
        expect_kind(tokens, 19, "COLON");
        expect_kind(tokens, 20, "NUMBER");
        expect_kind(tokens, 21, "RBRACE");
        expect_kind(tokens, 22, "COMMA");
        expect_kind(tokens, 23, "IDENT");
        expect_kind(tokens, 24, "COLON");
        expect_kind(tokens, 25, "NUMBER");
        expect_kind(tokens, 26, "RPAREN");
        if (
            tokens[3].text != program.vector_field_name ||
            tokens[11].text != program.multiset_field_name ||
            tokens[23].text != program.total_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact records-native base binding field order");
        }
        program.base_name = tokens[0].text;
        program.base_vector_first_value = parse_number(tokens[6].text);
        program.base_vector_second_value = parse_number(tokens[8].text);
        program.base_multiset_first_key = parse_number(tokens[14].text);
        program.base_multiset_first_count = static_cast<long long>(parse_number(tokens[16].text));
        program.base_multiset_second_key = parse_number(tokens[18].text);
        program.base_multiset_second_count = static_cast<long long>(parse_number(tokens[20].text));
        program.base_total_value = parse_number(tokens[25].text);
    }

    static void parse_records_extra_binding(const std::vector<Token>& tokens, RecordsProgram& program) {
        if (tokens.size() != 7) {
            throw std::runtime_error("native parser prototype expected records-native extra binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LBRACKET");
        expect_kind(tokens, 3, "NUMBER");
        expect_kind(tokens, 4, "COMMA");
        expect_kind(tokens, 5, "NUMBER");
        expect_kind(tokens, 6, "RBRACKET");
        if (tokens[0].text != program.extra_name) {
            throw std::runtime_error("native parser prototype expected exact records-native extra binding");
        }
        program.extra_first_value = parse_number(tokens[3].text);
        program.extra_second_value = parse_number(tokens[5].text);
    }

    static void parse_records_delta_binding(const std::vector<Token>& tokens, RecordsProgram& program) {
        if (tokens.size() != 11) {
            throw std::runtime_error("native parser prototype expected records-native delta binding shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LBRACE");
        expect_kind(tokens, 3, "NUMBER");
        expect_kind(tokens, 4, "COLON");
        expect_kind(tokens, 5, "NUMBER");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "NUMBER");
        expect_kind(tokens, 8, "COLON");
        expect_kind(tokens, 9, "NUMBER");
        expect_kind(tokens, 10, "RBRACE");
        if (tokens[0].text != program.delta_name) {
            throw std::runtime_error("native parser prototype expected exact records-native delta binding");
        }
        program.delta_first_key = parse_number(tokens[3].text);
        program.delta_first_count = static_cast<long long>(parse_number(tokens[5].text));
        program.delta_second_key = parse_number(tokens[7].text);
        program.delta_second_count = static_cast<long long>(parse_number(tokens[9].text));
    }

    static void parse_records_emit(const std::vector<Token>& tokens, const RecordsProgram& program) {
        if (tokens.size() != 9) {
            throw std::runtime_error("native parser prototype expected records-native emit shape");
        }
        expect_kind(tokens, 0, "EMIT");
        expect_kind(tokens, 1, "IDENT");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COMMA");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "RPAREN");
        if (
            tokens[1].text != program.function_name ||
            tokens[3].text != program.base_name ||
            tokens[5].text != program.extra_name ||
            tokens[7].text != program.delta_name
        ) {
            throw std::runtime_error("native parser prototype only supports ':: step(base, extra, delta)' for records-native");
        }
    }

    static void validate_records_program(const RecordsProgram& program) {
        if (
            program.function_name.empty() ||
            program.param_name.empty() ||
            program.vector_field_name.empty() ||
            program.multiset_field_name.empty() ||
            program.total_field_name.empty() ||
            program.extra_name.empty() ||
            program.delta_name.empty() ||
            program.base_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected records-native identifiers");
        }
    }

    static void parse_named_record_scene_point_typedef(const std::vector<Token>& tokens, NamedRecordSceneProgram& program) {
        if (tokens.size() != 11) {
            throw std::runtime_error("native parser prototype expected named-record-scene point typedef shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COLON");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COLON");
        expect_kind(tokens, 9, "IDENT");
        expect_kind(tokens, 10, "RPAREN");
        if (tokens[5].text != "num" || tokens[9].text != "num") {
            throw std::runtime_error("native parser prototype only supports num point fields in named-record-scene");
        }
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_state_typedef(const std::vector<Token>& tokens, NamedRecordSceneProgram& program) {
        if (tokens.size() != 21) {
            throw std::runtime_error("native parser prototype expected named-record-scene state typedef shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COLON");
        expect_kind(tokens, 5, "LBRACKET");
        expect_kind(tokens, 6, "IDENT");
        expect_kind(tokens, 7, "COLON");
        expect_kind(tokens, 8, "NUMBER");
        expect_kind(tokens, 9, "RBRACKET");
        expect_kind(tokens, 10, "COMMA");
        expect_kind(tokens, 11, "IDENT");
        expect_kind(tokens, 12, "COLON");
        expect_kind(tokens, 13, "LBRACE");
        expect_kind(tokens, 14, "IDENT");
        expect_kind(tokens, 15, "RBRACE");
        expect_kind(tokens, 16, "COMMA");
        expect_kind(tokens, 17, "IDENT");
        expect_kind(tokens, 18, "COLON");
        expect_kind(tokens, 19, "IDENT");
        expect_kind(tokens, 20, "RPAREN");
        if (tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num" || tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports State : (pts:[num:2], bag:{num}, total:num)");
        }
        program.state_type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_scene_scene_typedef(const std::vector<Token>& tokens, NamedRecordSceneProgram& program) {
        if (tokens.size() != 11) {
            throw std::runtime_error("native parser prototype expected named-record-scene scene typedef shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "COLON");
        expect_kind(tokens, 2, "LPAREN");
        expect_kind(tokens, 3, "IDENT");
        expect_kind(tokens, 4, "COLON");
        expect_kind(tokens, 5, "IDENT");
        expect_kind(tokens, 6, "COMMA");
        expect_kind(tokens, 7, "IDENT");
        expect_kind(tokens, 8, "COLON");
        expect_kind(tokens, 9, "IDENT");
        expect_kind(tokens, 10, "RPAREN");
        if (tokens[5].text != program.point_type_name || tokens[9].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype scene typedef must reference Point and State");
        }
        program.scene_type_name = tokens[0].text;
        program.anchor_field_name = tokens[3].text;
        program.state_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_header(const std::vector<Token>& tokens, NamedRecordSceneProgram& program) {
        if (tokens.size() != 27) {
            throw std::runtime_error("native parser prototype expected named-record-scene function header shape");
        }
        expect_kind(tokens, 0, "IDENT");
        expect_kind(tokens, 1, "LPAREN");
        expect_kind(tokens, 2, "IDENT");
        expect_kind(tokens, 3, "COLON");
        expect_kind(tokens, 4, "IDENT");
        expect_kind(tokens, 5, "COMMA");
        expect_kind(tokens, 6, "IDENT");
        expect_kind(tokens, 7, "COLON");
        expect_kind(tokens, 8, "IDENT");
        expect_kind(tokens, 9, "COMMA");
        expect_kind(tokens, 10, "IDENT");
        expect_kind(tokens, 11, "COLON");
        expect_kind(tokens, 12, "LBRACKET");
        expect_kind(tokens, 13, "IDENT");
        expect_kind(tokens, 14, "COLON");
        expect_kind(tokens, 15, "NUMBER");
        expect_kind(tokens, 16, "RBRACKET");
        expect_kind(tokens, 17, "COMMA");
        expect_kind(tokens, 18, "IDENT");
        expect_kind(tokens, 19, "COLON");
        expect_kind(tokens, 20, "LBRACE");
        expect_kind(tokens, 21, "IDENT");
        expect_kind(tokens, 22, "RBRACE");
        expect_kind(tokens, 23, "RPAREN");
        expect_kind(tokens, 24, "ARROW");
        expect_kind(tokens, 25, "IDENT");
        expect_kind(tokens, 26, "COLON");
        if (
            tokens[4].text != program.scene_type_name ||
            tokens[8].text != program.point_type_name ||
            tokens[13].text != "num" ||
            tokens[15].text != "2" ||
            tokens[21].text != "num" ||
            tokens[25].text != program.scene_type_name
        ) {
            throw std::runtime_error("native parser prototype only supports the exact named-record-scene signature");
        }
        program.function_name = tokens[0].text;
        program.scene_param_name = tokens[2].text;
        program.shift_param_name = tokens[6].text;
        program.extra_param_name = tokens[10].text;
        program.delta_param_name = tokens[18].text;
    }

    static void parse_named_record_scene_body(const std::vector<Token>& tokens, const NamedRecordSceneProgram& program) {
        if (tokens.size() != 63) {
            throw std::runtime_error("native parser prototype expected named-record-scene body shape");
        }
        // anchor:(x:scene.anchor.x + shift.x, y:scene.anchor.y + shift.y)
        if (
            tokens[0].kind != "LPAREN" ||
            tokens[1].text != program.anchor_field_name ||
            tokens[2].kind != "COLON" ||
            tokens[3].kind != "LPAREN" ||
            tokens[4].text != program.point_first_field_name ||
            tokens[5].kind != "COLON" ||
            tokens[6].text != program.scene_param_name ||
            tokens[7].kind != "DOT" ||
            tokens[8].text != program.anchor_field_name ||
            tokens[9].kind != "DOT" ||
            tokens[10].text != program.point_first_field_name ||
            tokens[11].kind != "PLUS" ||
            tokens[12].text != program.shift_param_name ||
            tokens[13].kind != "DOT" ||
            tokens[14].text != program.point_first_field_name ||
            tokens[15].kind != "COMMA" ||
            tokens[16].text != program.point_second_field_name ||
            tokens[17].kind != "COLON" ||
            tokens[18].text != program.scene_param_name ||
            tokens[19].kind != "DOT" ||
            tokens[20].text != program.anchor_field_name ||
            tokens[21].kind != "DOT" ||
            tokens[22].text != program.point_second_field_name ||
            tokens[23].kind != "PLUS" ||
            tokens[24].text != program.shift_param_name ||
            tokens[25].kind != "DOT" ||
            tokens[26].text != program.point_second_field_name ||
            tokens[27].kind != "RPAREN" ||
            tokens[28].kind != "COMMA" ||
            tokens[29].text != program.state_field_name ||
            tokens[30].kind != "COLON" ||
            tokens[31].kind != "LPAREN" ||
            tokens[32].text != program.vector_field_name ||
            tokens[33].kind != "COLON" ||
            tokens[34].text != program.scene_param_name ||
            tokens[35].kind != "DOT" ||
            tokens[36].text != program.state_field_name ||
            tokens[37].kind != "DOT" ||
            tokens[38].text != program.vector_field_name ||
            tokens[39].kind != "PLUS" ||
            tokens[40].text != program.extra_param_name ||
            tokens[41].kind != "COMMA" ||
            tokens[42].text != program.multiset_field_name ||
            tokens[43].kind != "COLON" ||
            tokens[44].text != program.scene_param_name ||
            tokens[45].kind != "DOT" ||
            tokens[46].text != program.state_field_name ||
            tokens[47].kind != "DOT" ||
            tokens[48].text != program.multiset_field_name ||
            tokens[49].kind != "PLUS" ||
            tokens[50].text != program.delta_param_name ||
            tokens[51].kind != "COMMA" ||
            tokens[52].text != program.total_field_name ||
            tokens[53].kind != "COLON" ||
            tokens[54].text != program.scene_param_name ||
            tokens[55].kind != "DOT" ||
            tokens[56].text != program.state_field_name ||
            tokens[57].kind != "DOT" ||
            tokens[58].text != program.total_field_name ||
            tokens[59].kind != "PLUS" ||
            tokens[60].kind != "NUMBER" ||
            tokens[60].text != "1" ||
            tokens[61].kind != "RPAREN" ||
            tokens[62].kind != "RPAREN"
        ) {
            throw std::runtime_error("native parser prototype expected exact named-record-scene body shape");
        }
    }

    static void parse_named_record_scene_base_binding(const std::vector<Token>& tokens, NamedRecordSceneProgram& program) {
        if (tokens.size() != 40) {
            throw std::runtime_error("native parser prototype expected named-record-scene base binding shape");
        }
        if (
            tokens[0].text != program.scene_type_name ||
            tokens[2].kind != "COLON" ||
            tokens[3].kind != "LPAREN" ||
            tokens[4].text != program.anchor_field_name ||
            tokens[5].kind != "COLON" ||
            tokens[6].kind != "LPAREN" ||
            tokens[7].text != program.point_first_field_name ||
            tokens[8].kind != "COLON" ||
            tokens[9].kind != "NUMBER" ||
            tokens[10].kind != "COMMA" ||
            tokens[11].text != program.point_second_field_name ||
            tokens[12].kind != "COLON" ||
            tokens[13].kind != "NUMBER" ||
            tokens[14].kind != "RPAREN" ||
            tokens[15].kind != "COMMA" ||
            tokens[16].text != program.state_field_name ||
            tokens[17].kind != "COLON" ||
            tokens[18].kind != "LPAREN" ||
            tokens[19].text != program.vector_field_name ||
            tokens[20].kind != "COLON" ||
            tokens[21].kind != "LBRACKET" ||
            tokens[22].kind != "NUMBER" ||
            tokens[23].kind != "COMMA" ||
            tokens[24].kind != "NUMBER" ||
            tokens[25].kind != "RBRACKET" ||
            tokens[26].kind != "COMMA" ||
            tokens[27].text != program.multiset_field_name ||
            tokens[28].kind != "COLON" ||
            tokens[29].kind != "LBRACE" ||
            tokens[30].kind != "NUMBER" ||
            tokens[31].kind != "COLON" ||
            tokens[32].kind != "NUMBER" ||
            tokens[33].kind != "RBRACE" ||
            tokens[34].kind != "COMMA" ||
            tokens[35].text != program.total_field_name ||
            tokens[36].kind != "COLON" ||
            tokens[37].kind != "NUMBER" ||
            tokens[38].kind != "RPAREN" ||
            tokens[39].kind != "RPAREN"
        ) {
            throw std::runtime_error("native parser prototype expected exact named-record-scene base binding shape");
        }
        program.base_name = tokens[1].text;
        program.base_anchor_first_value = parse_number(tokens[9].text);
        program.base_anchor_second_value = parse_number(tokens[13].text);
        program.base_vector_first_value = parse_number(tokens[22].text);
        program.base_vector_second_value = parse_number(tokens[24].text);
        program.base_multiset_key = parse_number(tokens[30].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
        program.base_total_value = parse_number(tokens[37].text);
    }

    static void parse_named_record_scene_shift_binding(const std::vector<Token>& tokens, NamedRecordSceneProgram& program) {
        if (tokens.size() != 12) {
            throw std::runtime_error("native parser prototype expected named-record-scene shift binding shape");
        }
        if (
            tokens[0].text != program.point_type_name ||
            tokens[2].kind != "COLON" ||
            tokens[3].kind != "LPAREN" ||
            tokens[4].text != program.point_first_field_name ||
            tokens[5].kind != "COLON" ||
            tokens[6].kind != "NUMBER" ||
            tokens[7].kind != "COMMA" ||
            tokens[8].text != program.point_second_field_name ||
            tokens[9].kind != "COLON" ||
            tokens[10].kind != "NUMBER" ||
            tokens[11].kind != "RPAREN"
        ) {
            throw std::runtime_error("native parser prototype expected exact named-record-scene shift binding shape");
        }
        program.shift_name = tokens[1].text;
        program.shift_first_value = parse_number(tokens[6].text);
        program.shift_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_scene_moved_binding(const std::vector<Token>& tokens, NamedRecordSceneProgram& program) {
        if (tokens.size() != 21) {
            throw std::runtime_error("native parser prototype expected named-record-scene moved binding shape");
        }
        if (
            tokens[0].text != program.scene_type_name ||
            tokens[2].kind != "COLON" ||
            tokens[3].text != program.function_name ||
            tokens[4].kind != "LPAREN" ||
            tokens[5].text != program.base_name ||
            tokens[6].kind != "COMMA" ||
            tokens[7].text != program.shift_name ||
            tokens[8].kind != "COMMA" ||
            tokens[9].kind != "LBRACKET" ||
            tokens[10].kind != "NUMBER" ||
            tokens[11].kind != "COMMA" ||
            tokens[12].kind != "NUMBER" ||
            tokens[13].kind != "RBRACKET" ||
            tokens[14].kind != "COMMA" ||
            tokens[15].kind != "LBRACE" ||
            tokens[16].kind != "NUMBER" ||
            tokens[17].kind != "COLON" ||
            tokens[18].kind != "NUMBER" ||
            tokens[19].kind != "RBRACE" ||
            tokens[20].kind != "RPAREN"
        ) {
            throw std::runtime_error("native parser prototype expected exact named-record-scene moved binding shape");
        }
        program.moved_name = tokens[1].text;
        program.moved_vector_first_value = parse_number(tokens[10].text);
        program.moved_vector_second_value = parse_number(tokens[12].text);
        program.moved_multiset_key = parse_number(tokens[16].text);
        program.moved_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_emit_anchor_field(const std::vector<Token>& tokens, const NamedRecordSceneProgram& program) {
        if (
            tokens.size() != 6 ||
            tokens[0].kind != "EMIT" ||
            tokens[1].text != program.moved_name ||
            tokens[2].kind != "DOT" ||
            tokens[3].text != program.anchor_field_name ||
            tokens[4].kind != "DOT" ||
            tokens[5].text != program.point_first_field_name
        ) {
            throw std::runtime_error("native parser prototype expected ':: moved.anchor.x' for named-record-scene");
        }
    }

    static void parse_named_record_scene_emit_vector(const std::vector<Token>& tokens, const NamedRecordSceneProgram& program) {
        if (
            tokens.size() != 6 ||
            tokens[0].kind != "EMIT" ||
            tokens[1].text != program.moved_name ||
            tokens[2].kind != "DOT" ||
            tokens[3].text != program.state_field_name ||
            tokens[4].kind != "DOT" ||
            tokens[5].text != program.vector_field_name
        ) {
            throw std::runtime_error("native parser prototype expected ':: moved.state.pts' for named-record-scene");
        }
    }

    static void parse_named_record_scene_emit_multiset(const std::vector<Token>& tokens, const NamedRecordSceneProgram& program) {
        if (
            tokens.size() != 6 ||
            tokens[0].kind != "EMIT" ||
            tokens[1].text != program.moved_name ||
            tokens[2].kind != "DOT" ||
            tokens[3].text != program.state_field_name ||
            tokens[4].kind != "DOT" ||
            tokens[5].text != program.multiset_field_name
        ) {
            throw std::runtime_error("native parser prototype expected ':: moved.state.bag' for named-record-scene");
        }
    }

    static void parse_named_record_scene_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneProgram& program) {
        if (tokens.size() != 2 || tokens[0].kind != "EMIT" || tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype expected ':: moved' for named-record-scene");
        }
    }

    static void validate_nested_named_record_program(const NestedNamedRecordProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.box_type_name.empty() ||
            program.translate_function_name.empty() ||
            program.base_name.empty() ||
            program.moved_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected nested named-record program identifiers");
        }
    }

    static void validate_named_record_collections_program(const NamedRecordCollectionsProgram& program) {
        if (
            program.type_name.empty() ||
            program.function_name.empty() ||
            program.base_name.empty() ||
            program.moved_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-collections identifiers");
        }
    }

    static void validate_named_record_scene_program(const NamedRecordSceneProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.function_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.moved_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene identifiers");
        }
    }

    static void parse_named_record_scene_chain_point_typedef(const std::vector<Token>& tokens, NamedRecordSceneChainProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-chain point typedef shape");
        if (tokens[5].text != "num" || tokens[9].text != "num") throw std::runtime_error("native parser prototype only supports num point fields in named-record-scene-chain");
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_chain_state_typedef(const std::vector<Token>& tokens, NamedRecordSceneChainProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-chain state typedef shape");
        if (tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num" || tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports State : (pts:[num:2], bag:{num}, total:num)");
        }
        program.state_type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_scene_chain_scene_typedef(const std::vector<Token>& tokens, NamedRecordSceneChainProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-chain scene typedef shape");
        if (tokens[5].text != program.point_type_name || tokens[9].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype scene-chain typedef must reference Point and State");
        }
        program.scene_type_name = tokens[0].text;
        program.anchor_field_name = tokens[3].text;
        program.state_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_chain_header(const std::vector<Token>& tokens, NamedRecordSceneChainProgram& program) {
        if (tokens.size() != 27) throw std::runtime_error("native parser prototype expected named-record-scene-chain function header shape");
        if (
            tokens[4].text != program.scene_type_name ||
            tokens[8].text != program.point_type_name ||
            tokens[13].text != "num" ||
            tokens[15].text != "2" ||
            tokens[21].text != "num" ||
            tokens[25].text != program.scene_type_name
        ) {
            throw std::runtime_error("native parser prototype only supports the exact named-record-scene-chain signature");
        }
        program.function_name = tokens[0].text;
        program.scene_param_name = tokens[2].text;
        program.shift_param_name = tokens[6].text;
        program.extra_param_name = tokens[10].text;
        program.delta_param_name = tokens[18].text;
    }

    static void parse_named_record_scene_chain_body(const std::vector<Token>& tokens, const NamedRecordSceneChainProgram& program) {
        if (tokens.size() != 63) throw std::runtime_error("native parser prototype expected named-record-scene-chain body shape");
        if (
            tokens[1].text != program.anchor_field_name ||
            tokens[4].text != program.point_first_field_name ||
            tokens[6].text != program.scene_param_name ||
            tokens[8].text != program.anchor_field_name ||
            tokens[10].text != program.point_first_field_name ||
            tokens[12].text != program.shift_param_name ||
            tokens[14].text != program.point_first_field_name ||
            tokens[16].text != program.point_second_field_name ||
            tokens[18].text != program.scene_param_name ||
            tokens[20].text != program.anchor_field_name ||
            tokens[22].text != program.point_second_field_name ||
            tokens[24].text != program.shift_param_name ||
            tokens[26].text != program.point_second_field_name ||
            tokens[29].text != program.state_field_name ||
            tokens[32].text != program.vector_field_name ||
            tokens[34].text != program.scene_param_name ||
            tokens[36].text != program.state_field_name ||
            tokens[38].text != program.vector_field_name ||
            tokens[40].text != program.extra_param_name ||
            tokens[42].text != program.multiset_field_name ||
            tokens[44].text != program.scene_param_name ||
            tokens[46].text != program.state_field_name ||
            tokens[48].text != program.multiset_field_name ||
            tokens[50].text != program.delta_param_name ||
            tokens[52].text != program.total_field_name ||
            tokens[54].text != program.scene_param_name ||
            tokens[56].text != program.state_field_name ||
            tokens[58].text != program.total_field_name ||
            tokens[60].text != "1"
        ) {
            throw std::runtime_error("native parser prototype expected exact named-record-scene-chain body shape");
        }
    }

    static void parse_named_record_scene_chain_base_binding(const std::vector<Token>& tokens, NamedRecordSceneChainProgram& program) {
        if (tokens.size() != 40) throw std::runtime_error("native parser prototype expected named-record-scene-chain base binding shape");
        program.base_name = tokens[1].text;
        program.base_anchor_first_value = parse_number(tokens[9].text);
        program.base_anchor_second_value = parse_number(tokens[13].text);
        program.base_vector_first_value = parse_number(tokens[22].text);
        program.base_vector_second_value = parse_number(tokens[24].text);
        program.base_multiset_key = parse_number(tokens[30].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
        program.base_total_value = parse_number(tokens[37].text);
    }

    static void parse_named_record_scene_chain_shift_binding(const std::vector<Token>& tokens, NamedRecordSceneChainProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected named-record-scene-chain shift binding shape");
        program.shift_name = tokens[1].text;
        program.shift_first_value = parse_number(tokens[6].text);
        program.shift_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_scene_chain_first_binding(const std::vector<Token>& tokens, NamedRecordSceneChainProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-chain first binding shape");
        if (tokens[3].text != program.function_name || tokens[5].text != program.base_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact named-record-scene-chain first binding shape");
        }
        program.first_name = tokens[1].text;
        program.first_vector_first_value = parse_number(tokens[10].text);
        program.first_vector_second_value = parse_number(tokens[12].text);
        program.first_multiset_key = parse_number(tokens[16].text);
        program.first_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_chain_second_binding(const std::vector<Token>& tokens, NamedRecordSceneChainProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-chain second binding shape");
        if (tokens[3].text != program.function_name || tokens[5].text != program.first_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact named-record-scene-chain second binding shape");
        }
        program.second_name = tokens[1].text;
        program.second_vector_first_value = parse_number(tokens[10].text);
        program.second_vector_second_value = parse_number(tokens[12].text);
        program.second_multiset_key = parse_number(tokens[16].text);
        program.second_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_chain_emit_anchor_field(const std::vector<Token>& tokens, const NamedRecordSceneChainProgram& program) {
        if (
            tokens.size() != 6 ||
            tokens[1].text != program.second_name ||
            tokens[3].text != program.anchor_field_name ||
            tokens[5].text != program.point_first_field_name
        ) {
            throw std::runtime_error("native parser prototype expected ':: second.anchor.x' for named-record-scene-chain");
        }
    }

    static void parse_named_record_scene_chain_emit_total_field(const std::vector<Token>& tokens, const NamedRecordSceneChainProgram& program) {
        if (
            tokens.size() != 6 ||
            tokens[1].text != program.second_name ||
            tokens[3].text != program.state_field_name ||
            tokens[5].text != program.total_field_name
        ) {
            throw std::runtime_error("native parser prototype expected ':: second.state.total' for named-record-scene-chain");
        }
    }

    static void parse_named_record_scene_chain_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneChainProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.second_name) {
            throw std::runtime_error("native parser prototype expected ':: second' for named-record-scene-chain");
        }
    }

    static void validate_named_record_scene_chain_program(const NamedRecordSceneChainProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.function_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.first_name.empty() ||
            program.second_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-chain identifiers");
        }
    }

    static void parse_named_record_scene_helpers_point_typedef(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-helpers point typedef shape");
        if (tokens[5].text != "num" || tokens[9].text != "num") throw std::runtime_error("native parser prototype only supports num point fields in named-record-scene-helpers");
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_helpers_state_typedef(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-helpers state typedef shape");
        if (tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num" || tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports State : (pts:[num:2], bag:{num}, total:num)");
        }
        program.state_type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_scene_helpers_scene_typedef(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-helpers scene typedef shape");
        if (tokens[5].text != program.point_type_name || tokens[9].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype scene-helpers typedef must reference Point and State");
        }
        program.scene_type_name = tokens[0].text;
        program.anchor_field_name = tokens[3].text;
        program.state_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_helpers_shift_anchor_header(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 13) throw std::runtime_error("native parser prototype expected shift_anchor header shape");
        if (tokens[4].text != program.point_type_name || tokens[8].text != program.point_type_name || tokens[11].text != program.point_type_name) {
            throw std::runtime_error("native parser prototype only supports Point -> Point shift_anchor shape");
        }
        program.shift_anchor_function_name = tokens[0].text;
        program.shift_anchor_param_name = tokens[2].text;
        program.shift_anchor_shift_name = tokens[6].text;
    }

    static void parse_named_record_scene_helpers_shift_anchor_body(const std::vector<Token>& tokens, const NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected shift_anchor body shape");
        if (
            tokens[1].text != program.point_first_field_name ||
            tokens[3].text != program.shift_anchor_param_name ||
            tokens[5].text != program.point_first_field_name ||
            tokens[7].text != program.shift_anchor_shift_name ||
            tokens[9].text != program.point_first_field_name ||
            tokens[11].text != program.point_second_field_name ||
            tokens[13].text != program.shift_anchor_param_name ||
            tokens[15].text != program.point_second_field_name ||
            tokens[17].text != program.shift_anchor_shift_name ||
            tokens[19].text != program.point_second_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact shift_anchor body shape");
        }
    }

    static void parse_named_record_scene_helpers_bump_state_header(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 23) throw std::runtime_error("native parser prototype expected bump_state header shape");
        if (tokens[4].text != program.state_type_name || tokens[9].text != "num" || tokens[11].text != "2" || tokens[17].text != "num" || tokens[21].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype only supports exact bump_state shape");
        }
        program.bump_state_function_name = tokens[0].text;
        program.bump_state_param_name = tokens[2].text;
        program.bump_state_extra_name = tokens[6].text;
        program.bump_state_delta_name = tokens[14].text;
    }

    static void parse_named_record_scene_helpers_bump_state_body(const std::vector<Token>& tokens, const NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected bump_state body shape");
        if (
            tokens[1].text != program.vector_field_name ||
            tokens[3].text != program.bump_state_param_name ||
            tokens[5].text != program.vector_field_name ||
            tokens[7].text != program.bump_state_extra_name ||
            tokens[9].text != program.multiset_field_name ||
            tokens[11].text != program.bump_state_param_name ||
            tokens[13].text != program.multiset_field_name ||
            tokens[15].text != program.bump_state_delta_name ||
            tokens[17].text != program.total_field_name ||
            tokens[19].text != program.bump_state_param_name ||
            tokens[21].text != program.total_field_name ||
            tokens[23].text != "1"
        ) {
            throw std::runtime_error("native parser prototype expected exact bump_state body shape");
        }
    }

    static void parse_named_record_scene_helpers_step_header(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 27) throw std::runtime_error("native parser prototype expected step header shape");
        if (tokens[4].text != program.scene_type_name || tokens[8].text != program.point_type_name || tokens[13].text != "num" || tokens[15].text != "2" || tokens[21].text != "num" || tokens[25].text != program.scene_type_name) {
            throw std::runtime_error("native parser prototype only supports exact step shape");
        }
        program.step_function_name = tokens[0].text;
        program.scene_param_name = tokens[2].text;
        program.shift_param_name = tokens[6].text;
        program.extra_param_name = tokens[10].text;
        program.delta_param_name = tokens[18].text;
    }

    static void parse_named_record_scene_helpers_step_next_anchor(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 10) throw std::runtime_error("native parser prototype expected next_anchor helper shape");
        if (
            tokens[2].text != program.shift_anchor_function_name ||
            tokens[4].text != program.scene_param_name ||
            tokens[6].text != program.anchor_field_name ||
            tokens[8].text != program.shift_param_name
        ) {
            throw std::runtime_error("native parser prototype expected exact next_anchor helper shape");
        }
        program.next_anchor_name = tokens[0].text;
    }

    static void parse_named_record_scene_helpers_step_next_state(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected next_state helper shape");
        if (
            tokens[2].text != program.bump_state_function_name ||
            tokens[4].text != program.scene_param_name ||
            tokens[6].text != program.state_field_name ||
            tokens[8].text != program.extra_param_name ||
            tokens[10].text != program.delta_param_name
        ) {
            throw std::runtime_error("native parser prototype expected exact next_state helper shape");
        }
        program.next_state_name = tokens[0].text;
    }

    static void parse_named_record_scene_helpers_step_out_binding(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected out helper shape");
        if (
            tokens[3].text != program.anchor_field_name ||
            tokens[5].text != program.next_anchor_name ||
            tokens[7].text != program.state_field_name ||
            tokens[9].text != program.next_state_name
        ) {
            throw std::runtime_error("native parser prototype expected exact out helper shape");
        }
        program.out_name = tokens[0].text;
    }

    static void parse_named_record_scene_helpers_step_out_return(const std::vector<Token>& tokens, const NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 1 || tokens[0].text != program.out_name) {
            throw std::runtime_error("native parser prototype expected bare out return shape");
        }
    }

    static void parse_named_record_scene_helpers_base_binding(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 40) throw std::runtime_error("native parser prototype expected scene-helpers base binding shape");
        program.base_name = tokens[1].text;
        program.base_anchor_first_value = parse_number(tokens[9].text);
        program.base_anchor_second_value = parse_number(tokens[13].text);
        program.base_vector_first_value = parse_number(tokens[22].text);
        program.base_vector_second_value = parse_number(tokens[24].text);
        program.base_multiset_key = parse_number(tokens[30].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
        program.base_total_value = parse_number(tokens[37].text);
    }

    static void parse_named_record_scene_helpers_shift_binding(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-helpers shift binding shape");
        program.shift_name = tokens[1].text;
        program.shift_first_value = parse_number(tokens[6].text);
        program.shift_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_scene_helpers_moved_binding(const std::vector<Token>& tokens, NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-helpers moved binding shape");
        if (tokens[3].text != program.step_function_name || tokens[5].text != program.base_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-helpers moved binding shape");
        }
        program.moved_name = tokens[1].text;
        program.moved_vector_first_value = parse_number(tokens[10].text);
        program.moved_vector_second_value = parse_number(tokens[12].text);
        program.moved_multiset_key = parse_number(tokens[16].text);
        program.moved_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_helpers_emit_anchor_field(const std::vector<Token>& tokens, const NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.anchor_field_name || tokens[5].text != program.point_second_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.anchor.y' for named-record-scene-helpers");
        }
    }

    static void parse_named_record_scene_helpers_emit_total_field(const std::vector<Token>& tokens, const NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.state_field_name || tokens[5].text != program.total_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.state.total' for named-record-scene-helpers");
        }
    }

    static void parse_named_record_scene_helpers_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneHelpersProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype expected ':: moved' for named-record-scene-helpers");
        }
    }

    static void validate_named_record_scene_helpers_program(const NamedRecordSceneHelpersProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.shift_anchor_function_name.empty() ||
            program.bump_state_function_name.empty() ||
            program.step_function_name.empty() ||
            program.next_anchor_name.empty() ||
            program.next_state_name.empty() ||
            program.out_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.moved_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-helpers identifiers");
        }
    }

    static void parse_named_record_scene_handoff_point_typedef(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-handoff point typedef shape");
        if (tokens[5].text != "num" || tokens[9].text != "num") throw std::runtime_error("native parser prototype only supports num point fields in named-record-scene-handoff");
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_handoff_state_typedef(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-handoff state typedef shape");
        if (tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num" || tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports State : (pts:[num:2], bag:{num}, total:num)");
        }
        program.state_type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_scene_handoff_scene_typedef(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-handoff scene typedef shape");
        if (tokens[5].text != program.point_type_name || tokens[9].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype scene-handoff typedef must reference Point and State");
        }
        program.scene_type_name = tokens[0].text;
        program.anchor_field_name = tokens[3].text;
        program.state_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_handoff_shift_anchor_header(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 13) throw std::runtime_error("native parser prototype expected shift_anchor header shape");
        if (tokens[4].text != program.point_type_name || tokens[8].text != program.point_type_name || tokens[11].text != program.point_type_name) {
            throw std::runtime_error("native parser prototype only supports exact shift_anchor shape");
        }
        program.shift_anchor_function_name = tokens[0].text;
        program.shift_anchor_param_name = tokens[2].text;
        program.shift_anchor_shift_name = tokens[6].text;
    }

    static void parse_named_record_scene_handoff_shift_anchor_body(const std::vector<Token>& tokens, const NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected shift_anchor body shape");
        if (
            tokens[1].text != program.point_first_field_name ||
            tokens[3].text != program.shift_anchor_param_name ||
            tokens[5].text != program.point_first_field_name ||
            tokens[7].text != program.shift_anchor_shift_name ||
            tokens[9].text != program.point_first_field_name ||
            tokens[11].text != program.point_second_field_name ||
            tokens[13].text != program.shift_anchor_param_name ||
            tokens[15].text != program.point_second_field_name ||
            tokens[17].text != program.shift_anchor_shift_name ||
            tokens[19].text != program.point_second_field_name
        ) {
            throw std::runtime_error("native parser prototype only supports exact shift_anchor body shape");
        }
    }

    static void parse_named_record_scene_handoff_bump_state_header(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 23) throw std::runtime_error("native parser prototype expected bump_state header shape");
        if (tokens[4].text != program.state_type_name || tokens[9].text != "num" || tokens[11].text != "2" || tokens[17].text != "num" || tokens[21].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype only supports exact bump_state shape");
        }
        program.bump_state_function_name = tokens[0].text;
        program.bump_state_param_name = tokens[2].text;
        program.bump_state_extra_name = tokens[6].text;
        program.bump_state_delta_name = tokens[14].text;
    }

    static void parse_named_record_scene_handoff_bump_state_body(const std::vector<Token>& tokens, const NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected bump_state body shape");
        if (
            tokens[1].text != program.vector_field_name ||
            tokens[3].text != program.bump_state_param_name ||
            tokens[5].text != program.vector_field_name ||
            tokens[7].text != program.bump_state_extra_name ||
            tokens[9].text != program.multiset_field_name ||
            tokens[11].text != program.bump_state_param_name ||
            tokens[13].text != program.multiset_field_name ||
            tokens[15].text != program.bump_state_delta_name ||
            tokens[17].text != program.total_field_name ||
            tokens[19].text != program.bump_state_param_name ||
            tokens[21].text != program.total_field_name ||
            tokens[23].text != "1"
        ) {
            throw std::runtime_error("native parser prototype only supports exact bump_state body shape");
        }
    }

    static void parse_named_record_scene_handoff_step_header(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 27) throw std::runtime_error("native parser prototype expected step header shape");
        if (tokens[4].text != program.scene_type_name || tokens[8].text != program.point_type_name || tokens[13].text != "num" || tokens[15].text != "2" || tokens[21].text != "num" || tokens[25].text != program.scene_type_name) {
            throw std::runtime_error("native parser prototype only supports exact step shape");
        }
        program.step_function_name = tokens[0].text;
        program.scene_param_name = tokens[2].text;
        program.shift_param_name = tokens[6].text;
        program.extra_param_name = tokens[10].text;
        program.delta_param_name = tokens[18].text;
    }

    static void parse_named_record_scene_handoff_step_next_anchor(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 10) throw std::runtime_error("native parser prototype expected next_anchor helper shape");
        if (tokens[2].text != program.shift_anchor_function_name || tokens[4].text != program.scene_param_name || tokens[6].text != program.anchor_field_name || tokens[8].text != program.shift_param_name) {
            throw std::runtime_error("native parser prototype expected exact next_anchor helper shape");
        }
        program.next_anchor_name = tokens[0].text;
    }

    static void parse_named_record_scene_handoff_step_next_state(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected next_state helper shape");
        if (tokens[2].text != program.bump_state_function_name || tokens[4].text != program.scene_param_name || tokens[6].text != program.state_field_name || tokens[8].text != program.extra_param_name || tokens[10].text != program.delta_param_name) {
            throw std::runtime_error("native parser prototype expected exact next_state helper shape");
        }
        program.next_state_name = tokens[0].text;
    }

    static void parse_named_record_scene_handoff_step_out_binding(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected out helper shape");
        if (tokens[3].text != program.anchor_field_name || tokens[5].text != program.next_anchor_name || tokens[7].text != program.state_field_name || tokens[9].text != program.next_state_name) {
            throw std::runtime_error("native parser prototype expected exact out helper shape");
        }
        program.out_name = tokens[0].text;
    }

    static void parse_named_record_scene_handoff_step_out_return(const std::vector<Token>& tokens, const NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 1 || tokens[0].text != program.out_name) {
            throw std::runtime_error("native parser prototype expected bare out return shape");
        }
    }

    static void parse_named_record_scene_handoff_base_binding(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 40) throw std::runtime_error("native parser prototype expected scene-handoff base binding shape");
        program.base_name = tokens[1].text;
        program.base_anchor_first_value = parse_number(tokens[9].text);
        program.base_anchor_second_value = parse_number(tokens[13].text);
        program.base_vector_first_value = parse_number(tokens[22].text);
        program.base_vector_second_value = parse_number(tokens[24].text);
        program.base_multiset_key = parse_number(tokens[30].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
        program.base_total_value = parse_number(tokens[37].text);
    }

    static void parse_named_record_scene_handoff_shift_binding(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-handoff shift binding shape");
        program.shift_name = tokens[1].text;
        program.shift_first_value = parse_number(tokens[6].text);
        program.shift_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_scene_handoff_first_binding(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-handoff first binding shape");
        if (tokens[3].text != program.step_function_name || tokens[5].text != program.base_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-handoff first binding shape");
        }
        program.first_name = tokens[1].text;
        program.first_vector_first_value = parse_number(tokens[10].text);
        program.first_vector_second_value = parse_number(tokens[12].text);
        program.first_multiset_key = parse_number(tokens[16].text);
        program.first_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_handoff_second_binding(const std::vector<Token>& tokens, NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-handoff second binding shape");
        if (tokens[3].text != program.step_function_name || tokens[5].text != program.first_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-handoff second binding shape");
        }
        program.second_name = tokens[1].text;
        program.second_vector_first_value = parse_number(tokens[10].text);
        program.second_vector_second_value = parse_number(tokens[12].text);
        program.second_multiset_key = parse_number(tokens[16].text);
        program.second_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_handoff_emit_anchor_field(const std::vector<Token>& tokens, const NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.second_name || tokens[3].text != program.anchor_field_name || tokens[5].text != program.point_second_field_name) {
            throw std::runtime_error("native parser prototype expected ':: second.anchor.y' for named-record-scene-handoff");
        }
    }

    static void parse_named_record_scene_handoff_emit_total_field(const std::vector<Token>& tokens, const NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.second_name || tokens[3].text != program.state_field_name || tokens[5].text != program.total_field_name) {
            throw std::runtime_error("native parser prototype expected ':: second.state.total' for named-record-scene-handoff");
        }
    }

    static void parse_named_record_scene_handoff_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneHandoffProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.second_name) {
            throw std::runtime_error("native parser prototype expected ':: second' for named-record-scene-handoff");
        }
    }

    static void validate_named_record_scene_handoff_program(const NamedRecordSceneHandoffProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.shift_anchor_function_name.empty() ||
            program.bump_state_function_name.empty() ||
            program.step_function_name.empty() ||
            program.next_anchor_name.empty() ||
            program.next_state_name.empty() ||
            program.out_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.first_name.empty() ||
            program.second_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-handoff identifiers");
        }
    }

    static void parse_named_record_scene_compose_point_typedef(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-compose point typedef shape");
        if (tokens[5].text != "num" || tokens[9].text != "num") throw std::runtime_error("native parser prototype only supports num point fields in named-record-scene-compose");
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_compose_state_typedef(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-compose state typedef shape");
        if (tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num" || tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports State : (pts:[num:2], bag:{num}, total:num)");
        }
        program.state_type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_scene_compose_scene_typedef(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-compose scene typedef shape");
        if (tokens[5].text != program.point_type_name || tokens[9].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype scene-compose typedef must reference Point and State");
        }
        program.scene_type_name = tokens[0].text;
        program.anchor_field_name = tokens[3].text;
        program.state_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_compose_shift_anchor_header(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 13) throw std::runtime_error("native parser prototype expected shift_anchor header shape");
        if (tokens[4].text != program.point_type_name || tokens[8].text != program.point_type_name || tokens[11].text != program.point_type_name) {
            throw std::runtime_error("native parser prototype only supports exact shift_anchor shape");
        }
        program.shift_anchor_function_name = tokens[0].text;
        program.shift_anchor_param_name = tokens[2].text;
        program.shift_anchor_shift_name = tokens[6].text;
    }

    static void parse_named_record_scene_compose_shift_anchor_body(const std::vector<Token>& tokens, const NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected shift_anchor body shape");
        if (
            tokens[1].text != program.point_first_field_name ||
            tokens[3].text != program.shift_anchor_param_name ||
            tokens[5].text != program.point_first_field_name ||
            tokens[7].text != program.shift_anchor_shift_name ||
            tokens[9].text != program.point_first_field_name ||
            tokens[11].text != program.point_second_field_name ||
            tokens[13].text != program.shift_anchor_param_name ||
            tokens[15].text != program.point_second_field_name ||
            tokens[17].text != program.shift_anchor_shift_name ||
            tokens[19].text != program.point_second_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact shift_anchor body shape");
        }
    }

    static void parse_named_record_scene_compose_bump_state_header(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 23) throw std::runtime_error("native parser prototype expected bump_state header shape");
        if (tokens[4].text != program.state_type_name || tokens[9].text != "num" || tokens[11].text != "2" || tokens[17].text != "num" || tokens[21].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype only supports exact bump_state shape");
        }
        program.bump_state_function_name = tokens[0].text;
        program.bump_state_param_name = tokens[2].text;
        program.bump_state_extra_name = tokens[6].text;
        program.bump_state_delta_name = tokens[14].text;
    }

    static void parse_named_record_scene_compose_bump_state_body(const std::vector<Token>& tokens, const NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected bump_state body shape");
        if (
            tokens[1].text != program.vector_field_name ||
            tokens[3].text != program.bump_state_param_name ||
            tokens[5].text != program.vector_field_name ||
            tokens[7].text != program.bump_state_extra_name ||
            tokens[9].text != program.multiset_field_name ||
            tokens[11].text != program.bump_state_param_name ||
            tokens[13].text != program.multiset_field_name ||
            tokens[15].text != program.bump_state_delta_name ||
            tokens[17].text != program.total_field_name ||
            tokens[19].text != program.bump_state_param_name ||
            tokens[21].text != program.total_field_name ||
            tokens[23].text != "1"
        ) {
            throw std::runtime_error("native parser prototype expected exact bump_state body shape");
        }
    }

    static void parse_named_record_scene_compose_step_header(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 27) throw std::runtime_error("native parser prototype expected step header shape");
        if (tokens[4].text != program.scene_type_name || tokens[8].text != program.point_type_name || tokens[13].text != "num" || tokens[15].text != "2" || tokens[21].text != "num" || tokens[25].text != program.scene_type_name) {
            throw std::runtime_error("native parser prototype only supports exact step shape");
        }
        program.step_function_name = tokens[0].text;
        program.scene_param_name = tokens[2].text;
        program.shift_param_name = tokens[6].text;
        program.extra_param_name = tokens[10].text;
        program.delta_param_name = tokens[18].text;
    }

    static void parse_named_record_scene_compose_step_body(const std::vector<Token>& tokens, const NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 20) throw std::runtime_error("native parser prototype expected scene-compose step body shape");
        if (
            tokens[1].text != program.anchor_field_name ||
            tokens[3].text != program.scene_param_name ||
            tokens[5].text != program.anchor_field_name ||
            tokens[7].text != program.state_field_name ||
            tokens[9].text != program.bump_state_function_name ||
            tokens[11].text != program.scene_param_name ||
            tokens[13].text != program.state_field_name ||
            tokens[15].text != program.extra_param_name ||
            tokens[17].text != program.delta_param_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-compose step body shape");
        }
    }

    static void parse_named_record_scene_compose_base_binding(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 40) throw std::runtime_error("native parser prototype expected scene-compose base binding shape");
        program.base_name = tokens[1].text;
        program.base_anchor_first_value = parse_number(tokens[9].text);
        program.base_anchor_second_value = parse_number(tokens[13].text);
        program.base_vector_first_value = parse_number(tokens[22].text);
        program.base_vector_second_value = parse_number(tokens[24].text);
        program.base_multiset_key = parse_number(tokens[30].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
        program.base_total_value = parse_number(tokens[37].text);
    }

    static void parse_named_record_scene_compose_shift_binding(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-compose shift binding shape");
        program.shift_name = tokens[1].text;
        program.shift_first_value = parse_number(tokens[6].text);
        program.shift_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_scene_compose_moved_anchor_binding(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected scene-compose moved_anchor binding shape");
        if (tokens[0].text != program.point_type_name || tokens[3].text != program.shift_anchor_function_name || tokens[5].text != program.base_name || tokens[7].text != program.anchor_field_name || tokens[9].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-compose moved_anchor binding shape");
        }
        program.moved_anchor_name = tokens[1].text;
    }

    static void parse_named_record_scene_compose_staged_binding(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-compose staged binding shape");
        if (tokens[3].text != program.step_function_name || tokens[5].text != program.base_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-compose staged binding shape");
        }
        program.staged_name = tokens[1].text;
        program.staged_vector_first_value = parse_number(tokens[10].text);
        program.staged_vector_second_value = parse_number(tokens[12].text);
        program.staged_multiset_key = parse_number(tokens[16].text);
        program.staged_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_compose_moved_binding(const std::vector<Token>& tokens, NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 14) throw std::runtime_error("native parser prototype expected scene-compose moved binding shape");
        if (tokens[4].text != program.anchor_field_name || tokens[6].text != program.moved_anchor_name || tokens[8].text != program.state_field_name || tokens[10].text != program.staged_name || tokens[12].text != program.state_field_name) {
            throw std::runtime_error("native parser prototype expected exact scene-compose moved binding shape");
        }
        program.moved_name = tokens[1].text;
    }

    static void parse_named_record_scene_compose_emit_anchor_field(const std::vector<Token>& tokens, const NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.anchor_field_name || tokens[5].text != program.point_first_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.anchor.x' for named-record-scene-compose");
        }
    }

    static void parse_named_record_scene_compose_emit_total_field(const std::vector<Token>& tokens, const NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.state_field_name || tokens[5].text != program.total_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.state.total' for named-record-scene-compose");
        }
    }

    static void parse_named_record_scene_compose_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneComposeProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype expected ':: moved' for named-record-scene-compose");
        }
    }

    static void validate_named_record_scene_compose_program(const NamedRecordSceneComposeProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.shift_anchor_function_name.empty() ||
            program.bump_state_function_name.empty() ||
            program.step_function_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.moved_anchor_name.empty() ||
            program.staged_name.empty() ||
            program.moved_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-compose identifiers");
        }
    }

    static void parse_named_record_scene_patch_point_typedef(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-patch point typedef shape");
        if (tokens[5].text != "num" || tokens[9].text != "num") throw std::runtime_error("native parser prototype only supports num point fields in named-record-scene-patch");
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_patch_state_typedef(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-patch state typedef shape");
        if (tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num" || tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports State : (pts:[num:2], bag:{num}, total:num)");
        }
        program.state_type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_scene_patch_scene_typedef(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-patch scene typedef shape");
        if (tokens[5].text != program.point_type_name || tokens[9].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype scene-patch typedef must reference Point and State");
        }
        program.scene_type_name = tokens[0].text;
        program.anchor_field_name = tokens[3].text;
        program.state_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_patch_shift_anchor_header(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 13) throw std::runtime_error("native parser prototype expected shift_anchor header shape");
        if (tokens[4].text != program.point_type_name || tokens[8].text != program.point_type_name || tokens[11].text != program.point_type_name) {
            throw std::runtime_error("native parser prototype only supports exact shift_anchor shape");
        }
        program.shift_anchor_function_name = tokens[0].text;
        program.shift_anchor_param_name = tokens[2].text;
        program.shift_anchor_shift_name = tokens[6].text;
    }

    static void parse_named_record_scene_patch_shift_anchor_body(const std::vector<Token>& tokens, const NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected shift_anchor body shape");
        if (
            tokens[1].text != program.point_first_field_name ||
            tokens[3].text != program.shift_anchor_param_name ||
            tokens[5].text != program.point_first_field_name ||
            tokens[7].text != program.shift_anchor_shift_name ||
            tokens[9].text != program.point_first_field_name ||
            tokens[11].text != program.point_second_field_name ||
            tokens[13].text != program.shift_anchor_param_name ||
            tokens[15].text != program.point_second_field_name ||
            tokens[17].text != program.shift_anchor_shift_name ||
            tokens[19].text != program.point_second_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact shift_anchor body shape");
        }
    }

    static void parse_named_record_scene_patch_bump_state_header(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 23) throw std::runtime_error("native parser prototype expected bump_state header shape");
        if (tokens[4].text != program.state_type_name || tokens[9].text != "num" || tokens[11].text != "2" || tokens[17].text != "num" || tokens[21].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype only supports exact bump_state shape");
        }
        program.bump_state_function_name = tokens[0].text;
        program.bump_state_param_name = tokens[2].text;
        program.bump_state_extra_name = tokens[6].text;
        program.bump_state_delta_name = tokens[14].text;
    }

    static void parse_named_record_scene_patch_bump_state_body(const std::vector<Token>& tokens, const NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected bump_state body shape");
        if (
            tokens[1].text != program.vector_field_name ||
            tokens[3].text != program.bump_state_param_name ||
            tokens[5].text != program.vector_field_name ||
            tokens[7].text != program.bump_state_extra_name ||
            tokens[9].text != program.multiset_field_name ||
            tokens[11].text != program.bump_state_param_name ||
            tokens[13].text != program.multiset_field_name ||
            tokens[15].text != program.bump_state_delta_name ||
            tokens[17].text != program.total_field_name ||
            tokens[19].text != program.bump_state_param_name ||
            tokens[21].text != program.total_field_name ||
            tokens[23].text != "1"
        ) {
            throw std::runtime_error("native parser prototype expected exact bump_state body shape");
        }
    }

    static void parse_named_record_scene_patch_move_anchor_header(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 13) throw std::runtime_error("native parser prototype expected move_anchor header shape");
        if (tokens[4].text != program.scene_type_name || tokens[8].text != program.point_type_name || tokens[11].text != program.scene_type_name) {
            throw std::runtime_error("native parser prototype only supports exact move_anchor shape");
        }
        program.move_anchor_function_name = tokens[0].text;
        program.move_anchor_scene_name = tokens[2].text;
        program.move_anchor_shift_name = tokens[6].text;
    }

    static void parse_named_record_scene_patch_move_anchor_body(const std::vector<Token>& tokens, const NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 18) throw std::runtime_error("native parser prototype expected move_anchor body shape");
        if (
            tokens[1].text != program.anchor_field_name ||
            tokens[3].text != program.shift_anchor_function_name ||
            tokens[5].text != program.move_anchor_scene_name ||
            tokens[7].text != program.anchor_field_name ||
            tokens[9].text != program.move_anchor_shift_name ||
            tokens[12].text != program.state_field_name ||
            tokens[14].text != program.move_anchor_scene_name ||
            tokens[16].text != program.state_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact move_anchor body shape");
        }
    }

    static void parse_named_record_scene_patch_base_binding(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 40) throw std::runtime_error("native parser prototype expected scene-patch base binding shape");
        program.base_name = tokens[1].text;
        program.base_anchor_first_value = parse_number(tokens[9].text);
        program.base_anchor_second_value = parse_number(tokens[13].text);
        program.base_vector_first_value = parse_number(tokens[22].text);
        program.base_vector_second_value = parse_number(tokens[24].text);
        program.base_multiset_key = parse_number(tokens[30].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
        program.base_total_value = parse_number(tokens[37].text);
    }

    static void parse_named_record_scene_patch_shift_binding(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-patch shift binding shape");
        program.shift_name = tokens[1].text;
        program.shift_first_value = parse_number(tokens[6].text);
        program.shift_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_scene_patch_shifted_binding(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 9) throw std::runtime_error("native parser prototype expected scene-patch shifted binding shape");
        if (tokens[3].text != program.move_anchor_function_name || tokens[5].text != program.base_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-patch shifted binding shape");
        }
        program.shifted_name = tokens[1].text;
    }

    static void parse_named_record_scene_patch_patched_binding(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-patch patched binding shape");
        if (tokens[0].text != program.state_type_name || tokens[3].text != program.bump_state_function_name || tokens[5].text != program.shifted_name || tokens[7].text != program.state_field_name) {
            throw std::runtime_error("native parser prototype expected exact scene-patch patched binding shape");
        }
        program.patched_name = tokens[1].text;
        program.patched_vector_first_value = parse_number(tokens[10].text);
        program.patched_vector_second_value = parse_number(tokens[12].text);
        program.patched_multiset_key = parse_number(tokens[16].text);
        program.patched_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_patch_moved_binding(const std::vector<Token>& tokens, NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 14) throw std::runtime_error("native parser prototype expected scene-patch moved binding shape");
        if (tokens[4].text != program.anchor_field_name || tokens[6].text != program.shifted_name || tokens[8].text != program.anchor_field_name || tokens[10].text != program.state_field_name || tokens[12].text != program.patched_name) {
            throw std::runtime_error("native parser prototype expected exact scene-patch moved binding shape");
        }
        program.moved_name = tokens[1].text;
    }

    static void parse_named_record_scene_patch_emit_anchor_field(const std::vector<Token>& tokens, const NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.anchor_field_name || tokens[5].text != program.point_first_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.anchor.x' for named-record-scene-patch");
        }
    }

    static void parse_named_record_scene_patch_emit_total_field(const std::vector<Token>& tokens, const NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.state_field_name || tokens[5].text != program.total_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.state.total' for named-record-scene-patch");
        }
    }

    static void parse_named_record_scene_patch_emit_record(const std::vector<Token>& tokens, const NamedRecordScenePatchProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype expected ':: moved' for named-record-scene-patch");
        }
    }

    static void validate_named_record_scene_patch_program(const NamedRecordScenePatchProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.shift_anchor_function_name.empty() ||
            program.bump_state_function_name.empty() ||
            program.move_anchor_function_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.shifted_name.empty() ||
            program.patched_name.empty() ||
            program.moved_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-patch identifiers");
        }
    }

    static void parse_named_record_scene_split_point_typedef(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-split point typedef shape");
        if (tokens[5].text != "num" || tokens[9].text != "num") throw std::runtime_error("native parser prototype only supports num point fields in named-record-scene-split");
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_split_state_typedef(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-split state typedef shape");
        if (tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num" || tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports State : (pts:[num:2], bag:{num}, total:num)");
        }
        program.state_type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_scene_split_scene_typedef(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-split scene typedef shape");
        if (tokens[5].text != program.point_type_name || tokens[9].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype scene-split typedef must reference Point and State");
        }
        program.scene_type_name = tokens[0].text;
        program.anchor_field_name = tokens[3].text;
        program.state_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_split_shift_anchor_header(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 13) throw std::runtime_error("native parser prototype expected shift_anchor header shape");
        if (tokens[4].text != program.point_type_name || tokens[8].text != program.point_type_name || tokens[11].text != program.point_type_name) {
            throw std::runtime_error("native parser prototype only supports exact shift_anchor shape");
        }
        program.shift_anchor_function_name = tokens[0].text;
        program.shift_anchor_param_name = tokens[2].text;
        program.shift_anchor_shift_name = tokens[6].text;
    }

    static void parse_named_record_scene_split_shift_anchor_body(const std::vector<Token>& tokens, const NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected shift_anchor body shape");
        if (
            tokens[1].text != program.point_first_field_name ||
            tokens[3].text != program.shift_anchor_param_name ||
            tokens[5].text != program.point_first_field_name ||
            tokens[7].text != program.shift_anchor_shift_name ||
            tokens[9].text != program.point_first_field_name ||
            tokens[11].text != program.point_second_field_name ||
            tokens[13].text != program.shift_anchor_param_name ||
            tokens[15].text != program.point_second_field_name ||
            tokens[17].text != program.shift_anchor_shift_name ||
            tokens[19].text != program.point_second_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact shift_anchor body shape");
        }
    }

    static void parse_named_record_scene_split_bump_state_header(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 23) throw std::runtime_error("native parser prototype expected bump_state header shape");
        if (tokens[4].text != program.state_type_name || tokens[9].text != "num" || tokens[11].text != "2" || tokens[17].text != "num" || tokens[21].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype only supports exact bump_state shape");
        }
        program.bump_state_function_name = tokens[0].text;
        program.bump_state_param_name = tokens[2].text;
        program.bump_state_extra_name = tokens[6].text;
        program.bump_state_delta_name = tokens[14].text;
    }

    static void parse_named_record_scene_split_bump_state_body(const std::vector<Token>& tokens, const NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected bump_state body shape");
        if (
            tokens[1].text != program.vector_field_name ||
            tokens[3].text != program.bump_state_param_name ||
            tokens[5].text != program.vector_field_name ||
            tokens[7].text != program.bump_state_extra_name ||
            tokens[9].text != program.multiset_field_name ||
            tokens[11].text != program.bump_state_param_name ||
            tokens[13].text != program.multiset_field_name ||
            tokens[15].text != program.bump_state_delta_name ||
            tokens[17].text != program.total_field_name ||
            tokens[19].text != program.bump_state_param_name ||
            tokens[21].text != program.total_field_name ||
            tokens[23].text != "1"
        ) {
            throw std::runtime_error("native parser prototype expected exact bump_state body shape");
        }
    }

    static void parse_named_record_scene_split_step_header(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 27) throw std::runtime_error("native parser prototype expected step header shape");
        if (tokens[4].text != program.scene_type_name || tokens[8].text != program.point_type_name || tokens[13].text != "num" || tokens[15].text != "2" || tokens[21].text != "num" || tokens[25].text != program.scene_type_name) {
            throw std::runtime_error("native parser prototype only supports exact step shape");
        }
        program.step_function_name = tokens[0].text;
        program.scene_param_name = tokens[2].text;
        program.shift_param_name = tokens[6].text;
        program.extra_param_name = tokens[10].text;
        program.delta_param_name = tokens[18].text;
    }

    static void parse_named_record_scene_split_step_body(const std::vector<Token>& tokens, const NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected scene-split step body shape");
        if (
            tokens[1].text != program.anchor_field_name ||
            tokens[3].text != program.shift_anchor_function_name ||
            tokens[5].text != program.scene_param_name ||
            tokens[7].text != program.anchor_field_name ||
            tokens[9].text != program.shift_param_name ||
            tokens[12].text != program.state_field_name ||
            tokens[14].text != program.bump_state_function_name ||
            tokens[16].text != program.scene_param_name ||
            tokens[18].text != program.state_field_name ||
            tokens[20].text != program.extra_param_name ||
            tokens[22].text != program.delta_param_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-split step body shape");
        }
    }

    static void parse_named_record_scene_split_base_binding(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 40) throw std::runtime_error("native parser prototype expected scene-split base binding shape");
        program.base_name = tokens[1].text;
        program.base_anchor_first_value = parse_number(tokens[9].text);
        program.base_anchor_second_value = parse_number(tokens[13].text);
        program.base_vector_first_value = parse_number(tokens[22].text);
        program.base_vector_second_value = parse_number(tokens[24].text);
        program.base_multiset_key = parse_number(tokens[30].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
        program.base_total_value = parse_number(tokens[37].text);
    }

    static void parse_named_record_scene_split_shift_binding(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-split shift binding shape");
        program.shift_name = tokens[1].text;
        program.shift_first_value = parse_number(tokens[6].text);
        program.shift_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_scene_split_staged_binding(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-split staged binding shape");
        if (tokens[3].text != program.step_function_name || tokens[5].text != program.base_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-split staged binding shape");
        }
        program.staged_name = tokens[1].text;
        program.staged_vector_first_value = parse_number(tokens[10].text);
        program.staged_vector_second_value = parse_number(tokens[12].text);
        program.staged_multiset_key = parse_number(tokens[16].text);
        program.staged_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_relay_moved_binding(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 36) throw std::runtime_error("native parser prototype expected scene-relay moved binding shape");
        if (
            tokens[0].text != program.scene_type_name ||
            tokens[4].text != program.anchor_field_name ||
            tokens[6].text != program.shift_anchor_function_name ||
            tokens[8].text != program.staged_name ||
            tokens[10].text != program.anchor_field_name ||
            tokens[12].text != program.shift_name ||
            tokens[15].text != program.state_field_name ||
            tokens[17].text != program.bump_state_function_name ||
            tokens[19].text != program.staged_name ||
            tokens[21].text != program.state_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-relay moved binding shape");
        }
        program.moved_name = tokens[1].text;
        program.final_anchor_name = "final_anchor";
        program.final_state_name = "final_state";
        program.final_vector_first_value = parse_number(tokens[24].text);
        program.final_vector_second_value = parse_number(tokens[26].text);
        program.final_multiset_key = parse_number(tokens[30].text);
        program.final_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
    }

    static void parse_named_record_scene_split_final_anchor_binding(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected scene-split final_anchor binding shape");
        if (tokens[0].text != program.point_type_name || tokens[3].text != program.shift_anchor_function_name || tokens[5].text != program.staged_name || tokens[7].text != program.anchor_field_name || tokens[9].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-split final_anchor binding shape");
        }
        program.final_anchor_name = tokens[1].text;
    }

    static void parse_named_record_scene_split_final_state_binding(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-split final_state binding shape");
        if (tokens[0].text != program.state_type_name || tokens[3].text != program.bump_state_function_name || tokens[5].text != program.staged_name || tokens[7].text != program.state_field_name) {
            throw std::runtime_error("native parser prototype expected exact scene-split final_state binding shape");
        }
        program.final_state_name = tokens[1].text;
        program.final_vector_first_value = parse_number(tokens[10].text);
        program.final_vector_second_value = parse_number(tokens[12].text);
        program.final_multiset_key = parse_number(tokens[16].text);
        program.final_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_split_moved_binding(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-split moved binding shape");
        if (tokens[4].text != program.anchor_field_name || tokens[6].text != program.final_anchor_name || tokens[8].text != program.state_field_name || tokens[10].text != program.final_state_name) {
            throw std::runtime_error("native parser prototype expected exact scene-split moved binding shape");
        }
        program.moved_name = tokens[1].text;
    }

    static void parse_named_record_scene_reverse_moved_state_binding(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 31) throw std::runtime_error("native parser prototype expected scene-reverse moved_state binding shape");
        if (
            tokens[0].text != program.scene_type_name ||
            tokens[4].text != program.anchor_field_name ||
            tokens[6].text != program.staged_name ||
            tokens[8].text != program.anchor_field_name ||
            tokens[10].text != program.state_field_name ||
            tokens[12].text != program.bump_state_function_name ||
            tokens[14].text != program.staged_name ||
            tokens[16].text != program.state_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-reverse moved_state binding shape");
        }
        program.moved_state_name = tokens[1].text;
        program.final_vector_first_value = parse_number(tokens[19].text);
        program.final_vector_second_value = parse_number(tokens[21].text);
        program.final_multiset_key = parse_number(tokens[25].text);
        program.final_multiset_count = static_cast<long long>(parse_number(tokens[27].text));
    }

    static void parse_named_record_scene_reverse_final_anchor_binding(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected scene-reverse final_anchor binding shape");
        if (
            tokens[0].text != program.point_type_name ||
            tokens[3].text != program.shift_anchor_function_name ||
            tokens[5].text != program.moved_state_name ||
            tokens[7].text != program.anchor_field_name ||
            tokens[9].text != program.shift_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-reverse final_anchor binding shape");
        }
        program.final_anchor_name = tokens[1].text;
    }

    static void parse_named_record_scene_reverse_final_state_binding(const std::vector<Token>& tokens, NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 6) throw std::runtime_error("native parser prototype expected scene-reverse final_state binding shape");
        if (
            tokens[0].text != program.state_type_name ||
            tokens[3].text != program.moved_state_name ||
            tokens[5].text != program.state_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-reverse final_state binding shape");
        }
        program.final_state_name = tokens[1].text;
    }

    static void parse_named_record_scene_split_emit_anchor_field(const std::vector<Token>& tokens, const NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.anchor_field_name || tokens[5].text != program.point_second_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.anchor.y' for named-record-scene-split");
        }
    }

    static void parse_named_record_scene_split_emit_total_field(const std::vector<Token>& tokens, const NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.state_field_name || tokens[5].text != program.total_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.state.total' for named-record-scene-split");
        }
    }

    static void parse_named_record_scene_split_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneSplitProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype expected ':: moved' for named-record-scene-split");
        }
    }

    static void validate_named_record_scene_split_program(const NamedRecordSceneSplitProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.step_function_name.empty() ||
            program.shift_anchor_function_name.empty() ||
            program.bump_state_function_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.staged_name.empty() ||
            program.final_anchor_name.empty() ||
            program.final_state_name.empty() ||
            program.moved_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-split identifiers");
        }
    }

    static void parse_named_record_scene_rebuild_point_typedef(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-rebuild point typedef shape");
        if (tokens[5].text != "num" || tokens[9].text != "num") throw std::runtime_error("native parser prototype only supports num point fields in named-record-scene-rebuild");
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_rebuild_state_typedef(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-rebuild state typedef shape");
        if (tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num" || tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports State : (pts:[num:2], bag:{num}, total:num) in named-record-scene-rebuild");
        }
        program.state_type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_scene_rebuild_scene_typedef(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-rebuild scene typedef shape");
        if (tokens[5].text != program.point_type_name || tokens[9].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype scene-rebuild typedef must reference Point and State");
        }
        program.scene_type_name = tokens[0].text;
        program.anchor_field_name = tokens[3].text;
        program.state_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_rebuild_shift_anchor_header(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 13) throw std::runtime_error("native parser prototype expected shift_anchor header shape");
        if (tokens[4].text != program.point_type_name || tokens[8].text != program.point_type_name || tokens[11].text != program.point_type_name) {
            throw std::runtime_error("native parser prototype only supports exact shift_anchor shape");
        }
        program.shift_anchor_function_name = tokens[0].text;
        program.shift_anchor_param_name = tokens[2].text;
        program.shift_anchor_shift_name = tokens[6].text;
    }

    static void parse_named_record_scene_rebuild_shift_anchor_body(const std::vector<Token>& tokens, const NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected shift_anchor body shape");
        if (
            tokens[1].text != program.point_first_field_name ||
            tokens[3].text != program.shift_anchor_param_name ||
            tokens[5].text != program.point_first_field_name ||
            tokens[7].text != program.shift_anchor_shift_name ||
            tokens[9].text != program.point_first_field_name ||
            tokens[11].text != program.point_second_field_name ||
            tokens[13].text != program.shift_anchor_param_name ||
            tokens[15].text != program.point_second_field_name ||
            tokens[17].text != program.shift_anchor_shift_name ||
            tokens[19].text != program.point_second_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact shift_anchor body shape");
        }
    }

    static void parse_named_record_scene_rebuild_bump_state_header(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 23) throw std::runtime_error("native parser prototype expected bump_state header shape");
        if (tokens[4].text != program.state_type_name || tokens[9].text != "num" || tokens[11].text != "2" || tokens[17].text != "num" || tokens[21].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype only supports exact bump_state shape");
        }
        program.bump_state_function_name = tokens[0].text;
        program.bump_state_param_name = tokens[2].text;
        program.bump_state_extra_name = tokens[6].text;
        program.bump_state_delta_name = tokens[14].text;
    }

    static void parse_named_record_scene_rebuild_bump_state_body(const std::vector<Token>& tokens, const NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected bump_state body shape");
        if (
            tokens[1].text != program.vector_field_name ||
            tokens[3].text != program.bump_state_param_name ||
            tokens[5].text != program.vector_field_name ||
            tokens[7].text != program.bump_state_extra_name ||
            tokens[9].text != program.multiset_field_name ||
            tokens[11].text != program.bump_state_param_name ||
            tokens[13].text != program.multiset_field_name ||
            tokens[15].text != program.bump_state_delta_name ||
            tokens[17].text != program.total_field_name ||
            tokens[19].text != program.bump_state_param_name ||
            tokens[21].text != program.total_field_name ||
            tokens[23].text != "1"
        ) {
            throw std::runtime_error("native parser prototype expected exact bump_state body shape");
        }
    }

    static void parse_named_record_scene_rebuild_step_header(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 27) throw std::runtime_error("native parser prototype expected step header shape");
        if (tokens[4].text != program.scene_type_name || tokens[8].text != program.point_type_name || tokens[13].text != "num" || tokens[15].text != "2" || tokens[21].text != "num" || tokens[25].text != program.scene_type_name) {
            throw std::runtime_error("native parser prototype only supports exact step shape");
        }
        program.step_function_name = tokens[0].text;
        program.scene_param_name = tokens[2].text;
        program.shift_param_name = tokens[6].text;
        program.extra_param_name = tokens[10].text;
        program.delta_param_name = tokens[18].text;
    }

    static void parse_named_record_scene_rebuild_step_body(const std::vector<Token>& tokens, const NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected scene-rebuild step body shape");
        if (
            tokens[1].text != program.anchor_field_name ||
            tokens[3].text != program.shift_anchor_function_name ||
            tokens[5].text != program.scene_param_name ||
            tokens[7].text != program.anchor_field_name ||
            tokens[9].text != program.shift_param_name ||
            tokens[12].text != program.state_field_name ||
            tokens[14].text != program.bump_state_function_name ||
            tokens[16].text != program.scene_param_name ||
            tokens[18].text != program.state_field_name ||
            tokens[20].text != program.extra_param_name ||
            tokens[22].text != program.delta_param_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-rebuild step body shape");
        }
    }

    static void parse_named_record_scene_rebuild_base_binding(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 40) throw std::runtime_error("native parser prototype expected scene-rebuild base binding shape");
        program.base_name = tokens[1].text;
        program.base_anchor_first_value = parse_number(tokens[9].text);
        program.base_anchor_second_value = parse_number(tokens[13].text);
        program.base_vector_first_value = parse_number(tokens[22].text);
        program.base_vector_second_value = parse_number(tokens[24].text);
        program.base_multiset_key = parse_number(tokens[30].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
        program.base_total_value = parse_number(tokens[37].text);
    }

    static void parse_named_record_scene_rebuild_shift_binding(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-rebuild shift binding shape");
        program.shift_name = tokens[1].text;
        program.shift_first_value = parse_number(tokens[6].text);
        program.shift_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_scene_rebuild_staged_binding(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-rebuild staged binding shape");
        if (tokens[3].text != program.step_function_name || tokens[5].text != program.base_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-rebuild staged binding shape");
        }
        program.staged_name = tokens[1].text;
        program.staged_vector_first_value = parse_number(tokens[10].text);
        program.staged_vector_second_value = parse_number(tokens[12].text);
        program.staged_multiset_key = parse_number(tokens[16].text);
        program.staged_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_rebuild_moved_anchor_binding(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-rebuild moved_anchor binding shape");
        if (
            tokens[4].text != program.anchor_field_name ||
            tokens[6].text != program.shift_anchor_function_name ||
            tokens[8].text != program.staged_name ||
            tokens[10].text != program.anchor_field_name ||
            tokens[12].text != program.shift_name ||
            tokens[15].text != program.state_field_name ||
            tokens[17].text != program.staged_name ||
            tokens[19].text != program.state_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-rebuild moved_anchor binding shape");
        }
        program.moved_anchor_name = tokens[1].text;
    }

    static void parse_named_record_scene_rebuild_moved_binding(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 31) throw std::runtime_error("native parser prototype expected scene-rebuild moved binding shape");
        if (
            tokens[4].text != program.anchor_field_name ||
            tokens[6].text != program.moved_anchor_name ||
            tokens[8].text != program.anchor_field_name ||
            tokens[10].text != program.state_field_name ||
            tokens[12].text != program.bump_state_function_name ||
            tokens[14].text != program.moved_anchor_name ||
            tokens[16].text != program.state_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-rebuild moved binding shape");
        }
        program.moved_name = tokens[1].text;
        program.moved_vector_first_value = parse_number(tokens[19].text);
        program.moved_vector_second_value = parse_number(tokens[21].text);
        program.moved_multiset_key = parse_number(tokens[25].text);
        program.moved_multiset_count = static_cast<long long>(parse_number(tokens[27].text));
    }

    static void parse_named_record_scene_crossfade_moved_state_binding(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 31) throw std::runtime_error("native parser prototype expected scene-crossfade moved_state binding shape");
        if (
            tokens[0].text != program.scene_type_name ||
            tokens[4].text != program.anchor_field_name ||
            tokens[6].text != program.staged_name ||
            tokens[8].text != program.anchor_field_name ||
            tokens[10].text != program.state_field_name ||
            tokens[12].text != program.bump_state_function_name ||
            tokens[14].text != program.staged_name ||
            tokens[16].text != program.state_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-crossfade moved_state binding shape");
        }
        program.moved_state_name = tokens[1].text;
        program.moved_vector_first_value = parse_number(tokens[19].text);
        program.moved_vector_second_value = parse_number(tokens[21].text);
        program.moved_multiset_key = parse_number(tokens[25].text);
        program.moved_multiset_count = static_cast<long long>(parse_number(tokens[27].text));
    }

    static void parse_named_record_scene_crossfade_moved_binding(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 16) throw std::runtime_error("native parser prototype expected scene-crossfade moved binding shape");
        if (
            tokens[0].text != program.scene_type_name ||
            tokens[4].text != program.anchor_field_name ||
            tokens[6].text != program.moved_anchor_name ||
            tokens[8].text != program.anchor_field_name ||
            tokens[10].text != program.state_field_name ||
            tokens[12].text != program.moved_state_name ||
            tokens[14].text != program.state_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-crossfade moved binding shape");
        }
        program.moved_name = tokens[1].text;
    }

    static void parse_named_record_scene_crossfade_emit_anchor_field(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.anchor_field_name || tokens[5].text != program.point_second_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.anchor.y' for named-record-scene-crossfade");
        }
        program.emit_anchor_field_name = tokens[5].text;
    }

    static void parse_named_record_scene_rebuild_emit_anchor_field(const std::vector<Token>& tokens, NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.anchor_field_name || (tokens[5].text != program.point_first_field_name && tokens[5].text != program.point_second_field_name)) {
            throw std::runtime_error("native parser prototype expected ':: moved.anchor.x' for named-record-scene-rebuild");
        }
        program.emit_anchor_field_name = tokens[5].text;
    }

    static void parse_named_record_scene_rebuild_emit_total_field(const std::vector<Token>& tokens, const NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.state_field_name || tokens[5].text != program.total_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.state.total' for named-record-scene-rebuild");
        }
    }

    static void parse_named_record_scene_rebuild_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneRebuildProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype expected ':: moved' for named-record-scene-rebuild");
        }
    }

    static void validate_named_record_scene_rebuild_program(const NamedRecordSceneRebuildProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.step_function_name.empty() ||
            program.shift_anchor_function_name.empty() ||
            program.bump_state_function_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.staged_name.empty() ||
            program.moved_anchor_name.empty() ||
            program.moved_name.empty() ||
            program.emit_anchor_field_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-rebuild identifiers");
        }
    }

    static void parse_named_record_scene_splice_final_anchor_binding(const std::vector<Token>& tokens, NamedRecordSceneSpliceProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected scene-splice final_anchor binding shape");
        if (tokens[0].text != program.point_type_name || tokens[3].text != program.shift_anchor_function_name || tokens[5].text != program.shifted_name || tokens[7].text != program.anchor_field_name || tokens[9].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-splice final_anchor binding shape");
        }
        program.final_anchor_name = tokens[1].text;
    }

    static void parse_named_record_scene_splice_final_state_binding(const std::vector<Token>& tokens, NamedRecordSceneSpliceProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-splice final_state binding shape");
        if (tokens[0].text != program.state_type_name || tokens[3].text != program.bump_state_function_name || tokens[5].text != program.filled_name || tokens[7].text != program.state_field_name) {
            throw std::runtime_error("native parser prototype expected exact scene-splice final_state binding shape");
        }
        program.final_state_name = tokens[1].text;
        program.final_vector_first_value = parse_number(tokens[10].text);
        program.final_vector_second_value = parse_number(tokens[12].text);
        program.final_multiset_key = parse_number(tokens[16].text);
        program.final_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_splice_moved_binding(const std::vector<Token>& tokens, NamedRecordSceneSpliceProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-splice moved binding shape");
        if (tokens[4].text != program.anchor_field_name || tokens[6].text != program.final_anchor_name || tokens[8].text != program.state_field_name || tokens[10].text != program.final_state_name) {
            throw std::runtime_error("native parser prototype expected exact scene-splice moved binding shape");
        }
        program.moved_name = tokens[1].text;
    }

    static void parse_named_record_scene_splice_emit_anchor_field(const std::vector<Token>& tokens, const NamedRecordSceneSpliceProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.anchor_field_name || tokens[5].text != program.point_first_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.anchor.x' for named-record-scene-splice");
        }
    }

    static void parse_named_record_scene_splice_emit_total_field(const std::vector<Token>& tokens, const NamedRecordSceneSpliceProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.state_field_name || tokens[5].text != program.total_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.state.total' for named-record-scene-splice");
        }
    }

    static void parse_named_record_scene_splice_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneSpliceProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype expected ':: moved' for named-record-scene-splice");
        }
    }

    static void validate_named_record_scene_splice_program(const NamedRecordSceneSpliceProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.shift_anchor_function_name.empty() ||
            program.bump_state_function_name.empty() ||
            program.move_anchor_function_name.empty() ||
            program.fill_state_function_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.shifted_name.empty() ||
            program.filled_name.empty() ||
            program.final_anchor_name.empty() ||
            program.final_state_name.empty() ||
            program.moved_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-splice identifiers");
        }
    }

    static void parse_named_record_scene_fanout_first_anchor_binding(const std::vector<Token>& tokens, NamedRecordSceneFanoutProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected scene-fanout first_anchor binding shape");
        if (tokens[0].text != program.point_type_name || tokens[3].text != program.shift_anchor_function_name || tokens[5].text != program.base_name || tokens[7].text != program.anchor_field_name || tokens[9].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-fanout first_anchor binding shape");
        }
        program.first_anchor_name = tokens[1].text;
    }

    static void parse_named_record_scene_fanout_first_state_binding(const std::vector<Token>& tokens, NamedRecordSceneFanoutProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-fanout first_state binding shape");
        if (tokens[0].text != program.state_type_name || tokens[3].text != program.bump_state_function_name || tokens[5].text != program.base_name || tokens[7].text != program.state_field_name) {
            throw std::runtime_error("native parser prototype expected exact scene-fanout first_state binding shape");
        }
        program.first_state_name = tokens[1].text;
        program.first_vector_first_value = parse_number(tokens[10].text);
        program.first_vector_second_value = parse_number(tokens[12].text);
        program.first_multiset_key = parse_number(tokens[16].text);
        program.first_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_fanout_first_binding(const std::vector<Token>& tokens, NamedRecordSceneFanoutProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-fanout first binding shape");
        if (tokens[4].text != program.anchor_field_name || tokens[6].text != program.first_anchor_name || tokens[8].text != program.state_field_name || tokens[10].text != program.first_state_name) {
            throw std::runtime_error("native parser prototype expected exact scene-fanout first binding shape");
        }
        program.first_name = tokens[1].text;
    }

    static void parse_named_record_scene_fanout_second_anchor_binding(const std::vector<Token>& tokens, NamedRecordSceneFanoutProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected scene-fanout second_anchor binding shape");
        if (tokens[0].text != program.point_type_name || tokens[3].text != program.shift_anchor_function_name || tokens[5].text != program.first_name || tokens[7].text != program.anchor_field_name || tokens[9].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-fanout second_anchor binding shape");
        }
        program.second_anchor_name = tokens[1].text;
    }

    static void parse_named_record_scene_fanout_second_state_binding(const std::vector<Token>& tokens, NamedRecordSceneFanoutProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected scene-fanout second_state binding shape");
        if (tokens[0].text != program.state_type_name || tokens[3].text != program.bump_state_function_name || tokens[5].text != program.first_name || tokens[7].text != program.state_field_name) {
            throw std::runtime_error("native parser prototype expected exact scene-fanout second_state binding shape");
        }
        program.second_state_name = tokens[1].text;
        program.second_vector_first_value = parse_number(tokens[10].text);
        program.second_vector_second_value = parse_number(tokens[12].text);
        program.second_multiset_key = parse_number(tokens[16].text);
        program.second_multiset_count = static_cast<long long>(parse_number(tokens[18].text));
    }

    static void parse_named_record_scene_fanout_second_binding(const std::vector<Token>& tokens, NamedRecordSceneFanoutProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-fanout second binding shape");
        if (tokens[4].text != program.anchor_field_name || tokens[6].text != program.second_anchor_name || tokens[8].text != program.state_field_name || tokens[10].text != program.second_state_name) {
            throw std::runtime_error("native parser prototype expected exact scene-fanout second binding shape");
        }
        program.second_name = tokens[1].text;
    }

    static void parse_named_record_scene_fanout_emit_anchor_field(const std::vector<Token>& tokens, const NamedRecordSceneFanoutProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.second_name || tokens[3].text != program.anchor_field_name || tokens[5].text != program.point_first_field_name) {
            throw std::runtime_error("native parser prototype expected ':: second.anchor.x' for named-record-scene-fanout");
        }
    }

    static void parse_named_record_scene_fanout_emit_total_field(const std::vector<Token>& tokens, const NamedRecordSceneFanoutProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.second_name || tokens[3].text != program.state_field_name || tokens[5].text != program.total_field_name) {
            throw std::runtime_error("native parser prototype expected ':: second.state.total' for named-record-scene-fanout");
        }
    }

    static void parse_named_record_scene_fanout_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneFanoutProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.second_name) {
            throw std::runtime_error("native parser prototype expected ':: second' for named-record-scene-fanout");
        }
    }

    static void validate_named_record_scene_fanout_program(const NamedRecordSceneFanoutProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.shift_anchor_function_name.empty() ||
            program.bump_state_function_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.first_anchor_name.empty() ||
            program.first_state_name.empty() ||
            program.first_name.empty() ||
            program.second_anchor_name.empty() ||
            program.second_state_name.empty() ||
            program.second_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-fanout identifiers");
        }
    }

    static void parse_named_record_scene_checkpoint_point_typedef(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-checkpoint point typedef shape");
        if (tokens[0].text != "Point" || tokens[5].text != "num" || tokens[9].text != "num") {
            throw std::runtime_error("native parser prototype only supports exact checkpoint point shape");
        }
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_checkpoint_state_typedef(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-checkpoint state typedef shape");
        if (tokens[0].text != "State" || tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num" || tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports exact checkpoint state shape");
        }
        program.state_type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_scene_checkpoint_scene_typedef(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-checkpoint scene typedef shape");
        if (tokens[0].text != "Scene" || tokens[5].text != program.point_type_name || tokens[9].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype only supports exact checkpoint scene shape");
        }
        program.scene_type_name = tokens[0].text;
        program.anchor_field_name = tokens[3].text;
        program.state_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_checkpoint_shift_anchor_header(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 13) throw std::runtime_error("native parser prototype expected checkpoint shift_anchor header shape");
        if (tokens[4].text != program.point_type_name || tokens[8].text != program.point_type_name || tokens[11].text != program.point_type_name) {
            throw std::runtime_error("native parser prototype only supports exact checkpoint shift_anchor shape");
        }
        program.shift_anchor_function_name = tokens[0].text;
        program.shift_anchor_param_name = tokens[2].text;
        program.shift_anchor_shift_name = tokens[6].text;
    }

    static void parse_named_record_scene_checkpoint_shift_anchor_body(const std::vector<Token>& tokens, const NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected checkpoint shift_anchor body shape");
        if (
            tokens[2].text != program.point_first_field_name ||
            tokens[4].text != program.shift_anchor_param_name ||
            tokens[6].text != program.point_first_field_name ||
            tokens[8].text != program.shift_anchor_shift_name ||
            tokens[10].text != program.point_first_field_name ||
            tokens[12].text != program.point_second_field_name ||
            tokens[14].text != program.shift_anchor_param_name ||
            tokens[16].text != program.point_second_field_name ||
            tokens[18].text != program.shift_anchor_shift_name ||
            tokens[20].text != program.point_second_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact checkpoint shift_anchor body shape");
        }
    }

    static void parse_named_record_scene_checkpoint_bump_state_header(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 23) throw std::runtime_error("native parser prototype expected checkpoint bump_state header shape");
        if (tokens[4].text != program.state_type_name || tokens[9].text != "num" || tokens[11].text != "2" || tokens[17].text != "num" || tokens[21].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype only supports exact checkpoint bump_state shape");
        }
        program.bump_state_function_name = tokens[0].text;
        program.bump_state_param_name = tokens[2].text;
        program.bump_state_extra_name = tokens[6].text;
        program.bump_state_delta_name = tokens[14].text;
    }

    static void parse_named_record_scene_checkpoint_bump_state_body(const std::vector<Token>& tokens, const NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected checkpoint bump_state body shape");
        if (
            tokens[1].text != program.vector_field_name ||
            tokens[3].text != program.bump_state_param_name ||
            tokens[5].text != program.vector_field_name ||
            tokens[7].text != program.bump_state_extra_name ||
            tokens[9].text != program.multiset_field_name ||
            tokens[11].text != program.bump_state_param_name ||
            tokens[13].text != program.multiset_field_name ||
            tokens[15].text != program.bump_state_delta_name ||
            tokens[17].text != program.total_field_name ||
            tokens[19].text != program.bump_state_param_name ||
            tokens[21].text != program.total_field_name ||
            tokens[23].text != "1"
        ) {
            throw std::runtime_error("native parser prototype expected exact checkpoint bump_state body shape");
        }
    }

    static void parse_named_record_scene_checkpoint_step_header(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 27) throw std::runtime_error("native parser prototype expected checkpoint step header shape");
        if (tokens[4].text != program.scene_type_name || tokens[8].text != program.point_type_name || tokens[13].text != "num" || tokens[15].text != "2" || tokens[21].text != "num" || tokens[25].text != program.scene_type_name) {
            throw std::runtime_error("native parser prototype only supports exact checkpoint step shape");
        }
        program.step_function_name = tokens[0].text;
        program.scene_param_name = tokens[2].text;
        program.shift_param_name = tokens[6].text;
        program.extra_param_name = tokens[10].text;
        program.delta_param_name = tokens[18].text;
    }

    static void parse_named_record_scene_checkpoint_step_body(const std::vector<Token>& tokens, const NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected checkpoint step body shape");
        if (
            tokens[1].text != program.anchor_field_name ||
            tokens[3].text != program.shift_anchor_function_name ||
            tokens[5].text != program.scene_param_name ||
            tokens[7].text != program.anchor_field_name ||
            tokens[9].text != program.shift_param_name ||
            tokens[12].text != program.state_field_name ||
            tokens[14].text != program.bump_state_function_name ||
            tokens[16].text != program.scene_param_name ||
            tokens[18].text != program.state_field_name ||
            tokens[20].text != program.extra_param_name ||
            tokens[22].text != program.delta_param_name
        ) {
            throw std::runtime_error("native parser prototype expected exact checkpoint step body shape");
        }
    }

    static void parse_named_record_scene_checkpoint_base_binding(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 40) throw std::runtime_error("native parser prototype expected checkpoint base binding shape");
        program.base_name = tokens[1].text;
        program.base_anchor_first_value = parse_number(tokens[9].text);
        program.base_anchor_second_value = parse_number(tokens[13].text);
        program.base_vector_first_value = parse_number(tokens[22].text);
        program.base_vector_second_value = parse_number(tokens[24].text);
        program.base_multiset_key = parse_number(tokens[30].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
        program.base_total_value = parse_number(tokens[37].text);
    }

    static void parse_named_record_scene_checkpoint_shift_binding(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected checkpoint shift binding shape");
        program.shift_name = tokens[1].text;
        program.shift_first_value = parse_number(tokens[6].text);
        program.shift_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_scene_checkpoint_staged_binding(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected checkpoint staged binding shape");
        if (tokens[3].text != program.step_function_name || tokens[5].text != program.base_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact checkpoint staged binding shape");
        }
        program.staged_name = tokens[1].text;
    }

    static void parse_named_record_scene_checkpoint_checkpoint_binding(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 4) throw std::runtime_error("native parser prototype expected checkpoint alias shape");
        if (tokens[0].text != program.scene_type_name || tokens[3].text != program.staged_name) {
            throw std::runtime_error("native parser prototype expected exact checkpoint alias shape");
        }
        program.checkpoint_name = tokens[1].text;
    }

    static void parse_named_record_scene_checkpoint_moved_binding(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 4) throw std::runtime_error("native parser prototype expected checkpoint moved alias shape");
        if (tokens[0].text != program.scene_type_name || tokens[3].text != program.checkpoint_name) {
            throw std::runtime_error("native parser prototype expected exact checkpoint moved alias shape");
        }
        program.moved_name = tokens[1].text;
    }

    static void parse_named_record_scene_checkpoint_emit_anchor_field(const std::vector<Token>& tokens, NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.anchor_field_name || tokens[5].text != program.point_first_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.anchor.x' for named-record-scene-checkpoint");
        }
        program.emit_anchor_field_name = tokens[5].text;
    }

    static void parse_named_record_scene_checkpoint_emit_total_field(const std::vector<Token>& tokens, const NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.state_field_name || tokens[5].text != program.total_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.state.total' for named-record-scene-checkpoint");
        }
    }

    static void parse_named_record_scene_checkpoint_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneCheckpointProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype expected ':: moved' for named-record-scene-checkpoint");
        }
    }

    static void validate_named_record_scene_checkpoint_program(const NamedRecordSceneCheckpointProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.step_function_name.empty() ||
            program.shift_anchor_function_name.empty() ||
            program.bump_state_function_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.staged_name.empty() ||
            program.checkpoint_name.empty() ||
            program.moved_name.empty() ||
            program.emit_anchor_field_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-checkpoint identifiers");
        }
    }

    static void parse_named_record_scene_overlay_point_typedef(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-overlay point typedef shape");
        if (tokens[5].text != "num" || tokens[9].text != "num") throw std::runtime_error("native parser prototype only supports num point fields in named-record-scene-overlay");
        program.point_type_name = tokens[0].text;
        program.point_first_field_name = tokens[3].text;
        program.point_second_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_overlay_state_typedef(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected named-record-scene-overlay state typedef shape");
        if (tokens[6].text != "num" || tokens[8].text != "2" || tokens[14].text != "num" || tokens[19].text != "num") {
            throw std::runtime_error("native parser prototype only supports State : (pts:[num:2], bag:{num}, total:num) in named-record-scene-overlay");
        }
        program.state_type_name = tokens[0].text;
        program.vector_field_name = tokens[3].text;
        program.multiset_field_name = tokens[11].text;
        program.total_field_name = tokens[17].text;
    }

    static void parse_named_record_scene_overlay_scene_typedef(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 11) throw std::runtime_error("native parser prototype expected named-record-scene-overlay scene typedef shape");
        if (tokens[5].text != program.point_type_name || tokens[9].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype scene-overlay typedef must reference Point and State");
        }
        program.scene_type_name = tokens[0].text;
        program.anchor_field_name = tokens[3].text;
        program.state_field_name = tokens[7].text;
    }

    static void parse_named_record_scene_overlay_shift_anchor_header(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 13) throw std::runtime_error("native parser prototype expected shift_anchor header shape");
        if (tokens[4].text != program.point_type_name || tokens[8].text != program.point_type_name || tokens[11].text != program.point_type_name) {
            throw std::runtime_error("native parser prototype only supports exact shift_anchor shape");
        }
        program.shift_anchor_function_name = tokens[0].text;
        program.shift_anchor_param_name = tokens[2].text;
        program.shift_anchor_shift_name = tokens[6].text;
    }

    static void parse_named_record_scene_overlay_shift_anchor_body(const std::vector<Token>& tokens, const NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 21) throw std::runtime_error("native parser prototype expected shift_anchor body shape");
        if (
            tokens[1].text != program.point_first_field_name ||
            tokens[3].text != program.shift_anchor_param_name ||
            tokens[5].text != program.point_first_field_name ||
            tokens[7].text != program.shift_anchor_shift_name ||
            tokens[9].text != program.point_first_field_name ||
            tokens[11].text != program.point_second_field_name ||
            tokens[13].text != program.shift_anchor_param_name ||
            tokens[15].text != program.point_second_field_name ||
            tokens[17].text != program.shift_anchor_shift_name ||
            tokens[19].text != program.point_second_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact shift_anchor body shape");
        }
    }

    static void parse_named_record_scene_overlay_bump_state_header(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 23) throw std::runtime_error("native parser prototype expected bump_state header shape");
        if (tokens[4].text != program.state_type_name || tokens[9].text != "num" || tokens[11].text != "2" || tokens[17].text != "num" || tokens[21].text != program.state_type_name) {
            throw std::runtime_error("native parser prototype only supports exact bump_state shape");
        }
        program.bump_state_function_name = tokens[0].text;
        program.bump_state_param_name = tokens[2].text;
        program.bump_state_extra_name = tokens[6].text;
        program.bump_state_delta_name = tokens[14].text;
    }

    static void parse_named_record_scene_overlay_bump_state_body(const std::vector<Token>& tokens, const NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 25) throw std::runtime_error("native parser prototype expected bump_state body shape");
        if (
            tokens[1].text != program.vector_field_name ||
            tokens[3].text != program.bump_state_param_name ||
            tokens[5].text != program.vector_field_name ||
            tokens[7].text != program.bump_state_extra_name ||
            tokens[9].text != program.multiset_field_name ||
            tokens[11].text != program.bump_state_param_name ||
            tokens[13].text != program.multiset_field_name ||
            tokens[15].text != program.bump_state_delta_name ||
            tokens[17].text != program.total_field_name ||
            tokens[19].text != program.bump_state_param_name ||
            tokens[21].text != program.total_field_name ||
            tokens[23].text != "1"
        ) {
            throw std::runtime_error("native parser prototype expected exact bump_state body shape");
        }
    }

    static void parse_named_record_scene_overlay_move_anchor_header(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 13) throw std::runtime_error("native parser prototype expected move_anchor header shape");
        if (tokens[4].text != program.scene_type_name || tokens[8].text != program.point_type_name || tokens[11].text != program.scene_type_name) {
            throw std::runtime_error("native parser prototype only supports exact move_anchor shape");
        }
        program.move_anchor_function_name = tokens[0].text;
        program.move_anchor_scene_name = tokens[2].text;
        program.move_anchor_shift_name = tokens[6].text;
    }

    static void parse_named_record_scene_overlay_move_anchor_body(const std::vector<Token>& tokens, const NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 18) throw std::runtime_error("native parser prototype expected move_anchor body shape");
        if (
            tokens[1].text != program.anchor_field_name ||
            tokens[3].text != program.shift_anchor_function_name ||
            tokens[5].text != program.move_anchor_scene_name ||
            tokens[7].text != program.anchor_field_name ||
            tokens[9].text != program.move_anchor_shift_name ||
            tokens[12].text != program.state_field_name ||
            tokens[14].text != program.move_anchor_scene_name ||
            tokens[16].text != program.state_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact move_anchor body shape");
        }
    }

    static void parse_named_record_scene_overlay_fill_state_header(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 23) throw std::runtime_error("native parser prototype expected fill_state header shape");
        if (tokens[4].text != program.scene_type_name || tokens[9].text != "num" || tokens[11].text != "2" || tokens[17].text != "num" || tokens[21].text != program.scene_type_name) {
            throw std::runtime_error("native parser prototype only supports exact fill_state shape");
        }
        program.fill_state_function_name = tokens[0].text;
        program.fill_state_scene_name = tokens[2].text;
        program.fill_state_extra_name = tokens[6].text;
        program.fill_state_delta_name = tokens[14].text;
    }

    static void parse_named_record_scene_overlay_fill_state_body(const std::vector<Token>& tokens, const NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 20) throw std::runtime_error("native parser prototype expected fill_state body shape");
        if (
            tokens[1].text != program.anchor_field_name ||
            tokens[3].text != program.fill_state_scene_name ||
            tokens[5].text != program.anchor_field_name ||
            tokens[7].text != program.state_field_name ||
            tokens[9].text != program.bump_state_function_name ||
            tokens[11].text != program.fill_state_scene_name ||
            tokens[13].text != program.state_field_name ||
            tokens[15].text != program.fill_state_extra_name ||
            tokens[17].text != program.fill_state_delta_name
        ) {
            throw std::runtime_error("native parser prototype expected exact fill_state body shape");
        }
    }

    static void parse_named_record_scene_overlay_base_binding(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 40) throw std::runtime_error("native parser prototype expected scene-overlay base binding shape");
        program.base_name = tokens[1].text;
        program.base_anchor_first_value = parse_number(tokens[9].text);
        program.base_anchor_second_value = parse_number(tokens[13].text);
        program.base_vector_first_value = parse_number(tokens[22].text);
        program.base_vector_second_value = parse_number(tokens[24].text);
        program.base_multiset_key = parse_number(tokens[30].text);
        program.base_multiset_count = static_cast<long long>(parse_number(tokens[32].text));
        program.base_total_value = parse_number(tokens[37].text);
    }

    static void parse_named_record_scene_overlay_shift_binding(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 12) throw std::runtime_error("native parser prototype expected scene-overlay shift binding shape");
        program.shift_name = tokens[1].text;
        program.shift_first_value = parse_number(tokens[6].text);
        program.shift_second_value = parse_number(tokens[10].text);
    }

    static void parse_named_record_scene_overlay_shifted_binding(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 9) throw std::runtime_error("native parser prototype expected scene-overlay shifted binding shape");
        if (tokens[3].text != program.move_anchor_function_name || tokens[5].text != program.base_name || tokens[7].text != program.shift_name) {
            throw std::runtime_error("native parser prototype expected exact scene-overlay shifted binding shape");
        }
        program.shifted_name = tokens[1].text;
    }

    static void parse_named_record_scene_overlay_filled_binding(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 19) throw std::runtime_error("native parser prototype expected scene-overlay filled binding shape");
        if (tokens[3].text != program.fill_state_function_name || tokens[5].text != program.base_name) {
            throw std::runtime_error("native parser prototype expected exact scene-overlay filled binding shape");
        }
        program.filled_name = tokens[1].text;
        program.filled_vector_first_value = parse_number(tokens[8].text);
        program.filled_vector_second_value = parse_number(tokens[10].text);
        program.filled_multiset_key = parse_number(tokens[14].text);
        program.filled_multiset_count = static_cast<long long>(parse_number(tokens[16].text));
    }

    static void parse_named_record_scene_overlay_moved_binding(const std::vector<Token>& tokens, NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 16) throw std::runtime_error("native parser prototype expected scene-overlay moved binding shape");
        if (
            tokens[4].text != program.anchor_field_name ||
            tokens[6].text != program.shifted_name ||
            tokens[8].text != program.anchor_field_name ||
            tokens[10].text != program.state_field_name ||
            tokens[12].text != program.filled_name ||
            tokens[14].text != program.state_field_name
        ) {
            throw std::runtime_error("native parser prototype expected exact scene-overlay moved binding shape");
        }
        program.moved_name = tokens[1].text;
    }

    static void parse_named_record_scene_overlay_emit_anchor_field(const std::vector<Token>& tokens, const NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.anchor_field_name || tokens[5].text != program.point_first_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.anchor.x' for named-record-scene-overlay");
        }
    }

    static void parse_named_record_scene_overlay_emit_total_field(const std::vector<Token>& tokens, const NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 6 || tokens[1].text != program.moved_name || tokens[3].text != program.state_field_name || tokens[5].text != program.total_field_name) {
            throw std::runtime_error("native parser prototype expected ':: moved.state.total' for named-record-scene-overlay");
        }
    }

    static void parse_named_record_scene_overlay_emit_record(const std::vector<Token>& tokens, const NamedRecordSceneOverlayProgram& program) {
        if (tokens.size() != 2 || tokens[1].text != program.moved_name) {
            throw std::runtime_error("native parser prototype expected ':: moved' for named-record-scene-overlay");
        }
    }

    static void validate_named_record_scene_overlay_program(const NamedRecordSceneOverlayProgram& program) {
        if (
            program.point_type_name.empty() ||
            program.state_type_name.empty() ||
            program.scene_type_name.empty() ||
            program.shift_anchor_function_name.empty() ||
            program.bump_state_function_name.empty() ||
            program.move_anchor_function_name.empty() ||
            program.fill_state_function_name.empty() ||
            program.base_name.empty() ||
            program.shift_name.empty() ||
            program.shifted_name.empty() ||
            program.filled_name.empty() ||
            program.moved_name.empty()
        ) {
            throw std::runtime_error("native parser prototype expected named-record-scene-overlay identifiers");
        }
    }
};

static std::string format_number_literal(double value) {
    std::ostringstream out;
    out << std::setprecision(15) << value;
    return out.str();
}

static std::string emit_expression_cpp(const EmitExpressionProgram& program) {
    std::ostringstream out;
    out
        << "#include <iostream>\n\n"
        << "int main() {\n"
        << "    std::cout << " << program.cpp_expression << " << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_inline_function_cpp(const InlineFunctionProgram& program) {
    std::ostringstream out;
    out << "#include <iostream>\n\n";
        for (const auto& function : program.functions) {
            out << "static double " << function.function_name << "(";
            for (std::size_t i = 0; i < function.param_names.size(); ++i) {
                if (i > 0) {
                    out << ", ";
            }
            out << "double " << function.param_names[i];
        }
        out << ") {\n";
        for (const auto& binding : function.local_bindings) {
            out << "    double " << binding.first << " = " << binding.second << ";\n";
        }
        out
            << "    return " << function.return_cpp_expression << ";\n"
            << "}\n\n";
    }
    out << "int main() {\n";
    for (const auto& binding : program.top_level_bindings) {
        out << "    double " << binding.first << " = " << binding.second << ";\n";
    }
    out
        << "    std::cout << ";
    out
        << program.emit_cpp_expression << " << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_hello_cpp(const HelloProgram& program) {
    std::ostringstream out;
    out
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "double " << program.function_name << "(double " << program.param_name << ") {\n"
        << "    return " << program.param_name << " * " << format_number_literal(program.multiplier) << ";\n"
        << "}\n\n"
        << "int main() {\n"
        << "    std::cout << vf_format_num(" << program.function_name << "("
        << format_number_literal(program.call_arg) << ")) << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string format_vector_literal(const std::vector<double>& values) {
    std::ostringstream out;
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i) {
            out << ", ";
        }
        out << format_number_literal(values[i]);
    }
    return out.str();
}

static std::string emit_vector_cpp(const VectorProgram& program) {
    std::ostringstream out;
    out
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T>\n"
        << "static std::string vf_format_value(const T& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <>\n"
        << "inline std::string vf_format_value<double>(const double& value) {\n"
        << "    return vf_format_num(value);\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_value(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <std::size_t N>\n"
        << "std::array<double, N> " << program.function_name
        << "(const std::array<double, N>& " << program.left_param_name
        << ", const std::array<double, N>& " << program.right_param_name << ") {\n"
        << "    std::array<double, N> out{};\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        out[i] = (" << program.left_param_name << "[i] + " << program.right_param_name
        << "[i]) * " << format_number_literal(program.scale) << ";\n"
        << "    }\n"
        << "    return out;\n"
        << "}\n\n"
        << "int main() {\n"
        << "    std::array<double, " << program.extent << "> " << program.left_binding.name
        << " = std::array<double, " << program.extent << ">{" << format_vector_literal(program.left_binding.values) << "};\n"
        << "    std::array<double, " << program.extent << "> " << program.right_binding.name
        << " = std::array<double, " << program.extent << ">{" << format_vector_literal(program.right_binding.values) << "};\n"
        << "    std::cout << vf_format_value(" << program.function_name << "("
        << program.emit_left_name << ", " << program.emit_right_name << ")) << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_numeric_cpp(const NumericProgram& program) {
    const std::size_t extent = program.xs_binding.values.size();
    std::ostringstream out;
    out
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double v) {\n"
        << "    if (std::floor(v) == v) {\n"
        << "        std::ostringstream oss;\n"
        << "        oss << static_cast<long long>(v);\n"
        << "        return oss.str();\n"
        << "    }\n"
        << "    std::ostringstream oss;\n"
        << "    oss << std::setprecision(15) << v;\n"
        << "    return oss.str();\n"
        << "}\n"
        << "template <typename T>\n"
        << "static std::string vf_format_value(const T& v) {\n"
        << "    std::ostringstream oss;\n"
        << "    oss << v;\n"
        << "    return oss.str();\n"
        << "}\n"
        << "template <>\n"
        << "inline std::string vf_format_value<double>(const double& v) {\n"
        << "    return vf_format_num(v);\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& v) {\n"
        << "    std::ostringstream oss;\n"
        << "    oss << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) oss << \", \";\n"
        << "        oss << vf_format_value(v[i]);\n"
        << "    }\n"
        << "    oss << \"]\";\n"
        << "    return oss.str();\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static T vf_array_sum(const std::array<T, N>& arr) {\n"
        << "    T out{};\n"
        << "    for (std::size_t i = 0; i < N; ++i) out += arr[i];\n"
        << "    return out;\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static T vf_array_min(const std::array<T, N>& arr) {\n"
        << "    T out = arr[0];\n"
        << "    for (std::size_t i = 1; i < N; ++i) if (arr[i] < out) out = arr[i];\n"
        << "    return out;\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static T vf_array_max(const std::array<T, N>& arr) {\n"
        << "    T out = arr[0];\n"
        << "    for (std::size_t i = 1; i < N; ++i) if (arr[i] > out) out = arr[i];\n"
        << "    return out;\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static double vf_array_variance(const std::array<T, N>& arr) {\n"
        << "    double mu = static_cast<double>(vf_array_sum(arr)) / static_cast<double>(N);\n"
        << "    double out = 0.0;\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        double d = static_cast<double>(arr[i]) - mu;\n"
        << "        out += d * d;\n"
        << "    }\n"
        << "    return out / static_cast<double>(N);\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static double vf_array_std(const std::array<T, N>& arr) {\n"
        << "    return std::sqrt(vf_array_variance(arr));\n"
        << "}\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::array<double, N> vf_array_normalize(const std::array<T, N>& arr) {\n"
        << "    std::array<double, N> out{};\n"
        << "    double lo = static_cast<double>(vf_array_min(arr));\n"
        << "    double hi = static_cast<double>(vf_array_max(arr));\n"
        << "    if (hi == lo) return out;\n"
        << "    double span = hi - lo;\n"
        << "    for (std::size_t i = 0; i < N; ++i) out[i] = (static_cast<double>(arr[i]) - lo) / span;\n"
        << "    return out;\n"
        << "}\n"
        << "template <typename TX, typename TY, std::size_t N>\n"
        << "static double vf_array_covariance(const std::array<TX, N>& xs, const std::array<TY, N>& ys) {\n"
        << "    double mu_x = static_cast<double>(vf_array_sum(xs)) / static_cast<double>(N);\n"
        << "    double mu_y = static_cast<double>(vf_array_sum(ys)) / static_cast<double>(N);\n"
        << "    double out = 0.0;\n"
        << "    for (std::size_t i = 0; i < N; ++i) out += (static_cast<double>(xs[i]) - mu_x) * (static_cast<double>(ys[i]) - mu_y);\n"
        << "    return out / static_cast<double>(N);\n"
        << "}\n"
        << "template <typename TX, typename TY, std::size_t N>\n"
        << "static double vf_array_correlation(const std::array<TX, N>& xs, const std::array<TY, N>& ys) {\n"
        << "    double sx = vf_array_std(xs);\n"
        << "    double sy = vf_array_std(ys);\n"
        << "    if (sx == 0.0 || sy == 0.0) return 0.0;\n"
        << "    return vf_array_covariance(xs, ys) / (sx * sy);\n"
        << "}\n\n"
        << "int main() {\n"
        << "    std::array<double, " << extent << "> " << program.xs_binding.name
        << " = std::array<double, " << extent << ">{" << format_vector_literal(program.xs_binding.values) << "};\n"
        << "    std::array<double, " << extent << "> " << program.ys_binding.name
        << " = std::array<double, " << extent << ">{" << format_vector_literal(program.ys_binding.values) << "};\n"
        << "    std::cout << vf_format_num(std::sin(0.0)) << \"\\n\";\n"
        << "    std::cout << vf_format_num(3.14159265358979323846) << \"\\n\";\n"
        << "    std::cout << vf_format_num((static_cast<double>(vf_array_sum(" << program.xs_binding.name << ")) / static_cast<double>(" << extent << "))) << \"\\n\";\n"
        << "    std::cout << vf_format_value(vf_array_normalize(" << program.xs_binding.name << ")) << \"\\n\";\n"
        << "    std::cout << vf_format_num(vf_array_correlation(" << program.xs_binding.name << ", " << program.ys_binding.name << ")) << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_cpp(const NamedRecordProgram& program) {
    std::ostringstream out;
    out
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.type_name << " {\n"
        << "    double " << program.first_field_name << ";\n"
        << "    double " << program.second_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.first_field_name << ":\" << vf_format_num(value." << program.first_field_name << ")\n"
        << "        << \", " << program.second_field_name << ":\" << vf_format_num(value." << program.second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << program.type_name << " " << program.move_function_name << "(" << program.type_name << " " << program.param_name
        << ", double " << program.delta_x_name << ", double " << program.delta_y_name << ") {\n"
        << "    return " << program.type_name << "{"
        << program.param_name << "." << program.first_field_name << " + " << program.delta_x_name << ", "
        << program.param_name << "." << program.second_field_name << " + " << program.delta_y_name << "};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.type_name << " " << program.base_name << "{"
        << format_number_literal(program.base_first_value) << ", "
        << format_number_literal(program.base_second_value) << "};\n"
        << "    " << program.type_name << " " << program.shifted_name << " = " << program.move_function_name << "("
        << program.base_name << ", " << format_number_literal(program.shift_x_value) << ", "
        << format_number_literal(program.shift_y_value) << ");\n"
        << "    std::cout << vf_format_num(" << program.shifted_name << "." << program.first_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.shifted_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_nested_named_record_cpp(const NestedNamedRecordProgram& program) {
    std::ostringstream out;
    out
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.box_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.box_origin_field_name << ";\n"
        << "    " << program.point_type_name << " " << program.box_size_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.box_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.box_origin_field_name << ":\" << vf_format_value(value." << program.box_origin_field_name << ")\n"
        << "        << \", " << program.box_size_field_name << ":\" << vf_format_value(value." << program.box_size_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << program.box_type_name << " " << program.translate_function_name << "(" << program.box_type_name << " " << program.param_name
        << ", double " << program.delta_x_name << ", double " << program.delta_y_name << ") {\n"
        << "    return " << program.box_type_name << "{"
        << program.point_type_name << "{"
        << program.param_name << "." << program.box_origin_field_name << "." << program.point_first_field_name << " + " << program.delta_x_name << ", "
        << program.param_name << "." << program.box_origin_field_name << "." << program.point_second_field_name << " + " << program.delta_y_name << "}, "
        << program.param_name << "." << program.box_size_field_name << "};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.box_type_name << " " << program.base_name << "{"
        << program.point_type_name << "{" << format_number_literal(program.base_origin_first_value) << ", " << format_number_literal(program.base_origin_second_value) << "}, "
        << program.point_type_name << "{" << format_number_literal(program.base_size_first_value) << ", " << format_number_literal(program.base_size_second_value) << "}};\n"
        << "    " << program.box_type_name << " " << program.moved_name << " = " << program.translate_function_name << "("
        << program.base_name << ", " << format_number_literal(program.shift_x_value) << ", " << format_number_literal(program.shift_y_value) << ");\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.box_origin_field_name << "." << program.point_first_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_collections_cpp(const NamedRecordCollectionsProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count > 0) out[key] = count;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << program.type_name << " " << program.function_name << "(" << program.type_name << " " << program.param_name
        << ", const std::array<double, 2>& " << program.extra_name << ", const std::map<double, long long>& " << program.delta_name << ") {\n"
        << "    return " << program.type_name << "{"
        << "vf_array_add(" << program.param_name << "." << program.vector_field_name << ", " << program.extra_name << "), "
        << "vf_mset_union(" << program.param_name << "." << program.multiset_field_name << ", " << program.delta_name << "), "
        << program.param_name << "." << program.total_field_name << " + 1.0};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.type_name << " " << program.base_name << "{"
        << "std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_key) << ", " << program.base_multiset_count << "), "
        << format_number_literal(program.base_total_value) << "};\n"
        << "    " << program.type_name << " " << program.moved_name << " = " << program.function_name << "("
        << program.base_name << ", std::array<double, 2>{" << format_number_literal(program.moved_vector_first_value) << ", " << format_number_literal(program.moved_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.moved_multiset_key) << ", " << program.moved_multiset_count << "));\n"
        << "    std::cout << vf_format_value(" << program.moved_name << "." << program.vector_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << "." << program.multiset_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_records_cpp(const RecordsProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct RecordsState {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const RecordsState& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key1, long long count1, double key2, long long count2) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count1 > 0) out[key1] += count1;\n"
        << "    if (count2 > 0) out[key2] += count2;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << "RecordsState " << program.function_name << "(RecordsState " << program.param_name
        << ", const std::array<double, 2>& " << program.extra_name << ", const std::map<double, long long>& " << program.delta_name << ") {\n"
        << "    return RecordsState{"
        << "vf_array_add(" << program.param_name << "." << program.vector_field_name << ", " << program.extra_name << "), "
        << "vf_mset_union(" << program.param_name << "." << program.multiset_field_name << ", " << program.delta_name << "), "
        << program.param_name << "." << program.total_field_name << " + 2.0};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    RecordsState " << program.base_name << "{"
        << "std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_first_key) << ", " << program.base_multiset_first_count << ", "
        << format_number_literal(program.base_multiset_second_key) << ", " << program.base_multiset_second_count << "), "
        << format_number_literal(program.base_total_value) << "};\n"
        << "    std::array<double, 2> " << program.extra_name << "{"
        << format_number_literal(program.extra_first_value) << ", " << format_number_literal(program.extra_second_value) << "};\n"
        << "    std::map<double, long long> " << program.delta_name << " = vf_mset_make("
        << format_number_literal(program.delta_first_key) << ", " << program.delta_first_count << ", "
        << format_number_literal(program.delta_second_key) << ", " << program.delta_second_count << ");\n"
        << "    std::cout << vf_format_value(" << program.function_name << "(" << program.base_name << ", " << program.extra_name << ", " << program.delta_name << ")) << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_cpp(const NamedRecordSceneProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count > 0) out[key] = count;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.function_name << "(" << program.scene_type_name << " " << program.scene_param_name
        << ", " << program.point_type_name << " " << program.shift_param_name
        << ", const std::array<double, 2>& " << program.extra_param_name
        << ", const std::map<double, long long>& " << program.delta_param_name << ") {\n"
        << "    return " << program.scene_type_name << "{"
        << program.point_type_name << "{"
        << program.scene_param_name << "." << program.anchor_field_name << "." << program.point_first_field_name << " + " << program.shift_param_name << "." << program.point_first_field_name << ", "
        << program.scene_param_name << "." << program.anchor_field_name << "." << program.point_second_field_name << " + " << program.shift_param_name << "." << program.point_second_field_name << "}, "
        << program.state_type_name << "{"
        << "vf_array_add(" << program.scene_param_name << "." << program.state_field_name << "." << program.vector_field_name << ", " << program.extra_param_name << "), "
        << "vf_mset_union(" << program.scene_param_name << "." << program.state_field_name << "." << program.multiset_field_name << ", " << program.delta_param_name << "), "
        << program.scene_param_name << "." << program.state_field_name << "." << program.total_field_name << " + 1.0}};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{"
        << program.point_type_name << "{" << format_number_literal(program.base_anchor_first_value) << ", " << format_number_literal(program.base_anchor_second_value) << "}, "
        << program.state_type_name << "{std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_key) << ", " << program.base_multiset_count << "), "
        << format_number_literal(program.base_total_value) << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{"
        << format_number_literal(program.shift_first_value) << ", " << format_number_literal(program.shift_second_value) << "};\n"
        << "    " << program.scene_type_name << " " << program.moved_name << " = " << program.function_name << "("
        << program.base_name << ", " << program.shift_name << ", std::array<double, 2>{"
        << format_number_literal(program.moved_vector_first_value) << ", " << format_number_literal(program.moved_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.moved_multiset_key) << ", " << program.moved_multiset_count << "));\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.anchor_field_name << "." << program.point_first_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << "." << program.state_field_name << "." << program.vector_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << "." << program.state_field_name << "." << program.multiset_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_chain_cpp(const NamedRecordSceneChainProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count > 0) out[key] = count;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.function_name << "(" << program.scene_type_name << " " << program.scene_param_name
        << ", " << program.point_type_name << " " << program.shift_param_name
        << ", const std::array<double, 2>& " << program.extra_param_name
        << ", const std::map<double, long long>& " << program.delta_param_name << ") {\n"
        << "    return " << program.scene_type_name << "{"
        << program.point_type_name << "{"
        << program.scene_param_name << "." << program.anchor_field_name << "." << program.point_first_field_name << " + " << program.shift_param_name << "." << program.point_first_field_name << ", "
        << program.scene_param_name << "." << program.anchor_field_name << "." << program.point_second_field_name << " + " << program.shift_param_name << "." << program.point_second_field_name << "}, "
        << program.state_type_name << "{"
        << "vf_array_add(" << program.scene_param_name << "." << program.state_field_name << "." << program.vector_field_name << ", " << program.extra_param_name << "), "
        << "vf_mset_union(" << program.scene_param_name << "." << program.state_field_name << "." << program.multiset_field_name << ", " << program.delta_param_name << "), "
        << program.scene_param_name << "." << program.state_field_name << "." << program.total_field_name << " + 1.0}};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{"
        << program.point_type_name << "{" << format_number_literal(program.base_anchor_first_value) << ", " << format_number_literal(program.base_anchor_second_value) << "}, "
        << program.state_type_name << "{std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_key) << ", " << program.base_multiset_count << "), "
        << format_number_literal(program.base_total_value) << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{"
        << format_number_literal(program.shift_first_value) << ", " << format_number_literal(program.shift_second_value) << "};\n"
        << "    " << program.scene_type_name << " " << program.first_name << " = " << program.function_name << "("
        << program.base_name << ", " << program.shift_name << ", std::array<double, 2>{"
        << format_number_literal(program.first_vector_first_value) << ", " << format_number_literal(program.first_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.first_multiset_key) << ", " << program.first_multiset_count << "));\n"
        << "    " << program.scene_type_name << " " << program.second_name << " = " << program.function_name << "("
        << program.first_name << ", " << program.shift_name << ", std::array<double, 2>{"
        << format_number_literal(program.second_vector_first_value) << ", " << format_number_literal(program.second_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.second_multiset_key) << ", " << program.second_multiset_count << "));\n"
        << "    std::cout << vf_format_num(" << program.second_name << "." << program.anchor_field_name << "." << program.point_first_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.second_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.second_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_helpers_cpp(const NamedRecordSceneHelpersProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count > 0) out[key] = count;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << program.point_type_name << " " << program.shift_anchor_function_name << "(" << program.point_type_name << " " << program.shift_anchor_param_name
        << ", " << program.point_type_name << " " << program.shift_anchor_shift_name << ") {\n"
        << "    return " << program.point_type_name << "{"
        << program.shift_anchor_param_name << "." << program.point_first_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_first_field_name << ", "
        << program.shift_anchor_param_name << "." << program.point_second_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_second_field_name << "};\n"
        << "}\n\n"
        << program.state_type_name << " " << program.bump_state_function_name << "(" << program.state_type_name << " " << program.bump_state_param_name
        << ", const std::array<double, 2>& " << program.bump_state_extra_name
        << ", const std::map<double, long long>& " << program.bump_state_delta_name << ") {\n"
        << "    return " << program.state_type_name << "{"
        << "vf_array_add(" << program.bump_state_param_name << "." << program.vector_field_name << ", " << program.bump_state_extra_name << "), "
        << "vf_mset_union(" << program.bump_state_param_name << "." << program.multiset_field_name << ", " << program.bump_state_delta_name << "), "
        << program.bump_state_param_name << "." << program.total_field_name << " + 1.0};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.step_function_name << "(" << program.scene_type_name << " " << program.scene_param_name
        << ", " << program.point_type_name << " " << program.shift_param_name
        << ", const std::array<double, 2>& " << program.extra_param_name
        << ", const std::map<double, long long>& " << program.delta_param_name << ") {\n"
        << "    " << program.point_type_name << " " << program.next_anchor_name << " = " << program.shift_anchor_function_name << "("
        << program.scene_param_name << "." << program.anchor_field_name << ", " << program.shift_param_name << ");\n"
        << "    " << program.state_type_name << " " << program.next_state_name << " = " << program.bump_state_function_name << "("
        << program.scene_param_name << "." << program.state_field_name << ", " << program.extra_param_name << ", " << program.delta_param_name << ");\n"
        << "    " << program.scene_type_name << " " << program.out_name << "{"
        << program.next_anchor_name << ", " << program.next_state_name << "};\n"
        << "    return " << program.out_name << ";\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{"
        << program.point_type_name << "{" << format_number_literal(program.base_anchor_first_value) << ", " << format_number_literal(program.base_anchor_second_value) << "}, "
        << program.state_type_name << "{std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_key) << ", " << program.base_multiset_count << "), "
        << format_number_literal(program.base_total_value) << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{"
        << format_number_literal(program.shift_first_value) << ", " << format_number_literal(program.shift_second_value) << "};\n"
        << "    " << program.scene_type_name << " " << program.moved_name << " = " << program.step_function_name << "("
        << program.base_name << ", " << program.shift_name << ", std::array<double, 2>{"
        << format_number_literal(program.moved_vector_first_value) << ", " << format_number_literal(program.moved_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.moved_multiset_key) << ", " << program.moved_multiset_count << "));\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.anchor_field_name << "." << program.point_second_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_handoff_cpp(const NamedRecordSceneHandoffProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count > 0) out[key] = count;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << program.point_type_name << " " << program.shift_anchor_function_name << "(" << program.point_type_name << " " << program.shift_anchor_param_name
        << ", " << program.point_type_name << " " << program.shift_anchor_shift_name << ") {\n"
        << "    return " << program.point_type_name << "{"
        << program.shift_anchor_param_name << "." << program.point_first_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_first_field_name << ", "
        << program.shift_anchor_param_name << "." << program.point_second_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_second_field_name << "};\n"
        << "}\n\n"
        << program.state_type_name << " " << program.bump_state_function_name << "(" << program.state_type_name << " " << program.bump_state_param_name
        << ", const std::array<double, 2>& " << program.bump_state_extra_name
        << ", const std::map<double, long long>& " << program.bump_state_delta_name << ") {\n"
        << "    return " << program.state_type_name << "{"
        << "vf_array_add(" << program.bump_state_param_name << "." << program.vector_field_name << ", " << program.bump_state_extra_name << "), "
        << "vf_mset_union(" << program.bump_state_param_name << "." << program.multiset_field_name << ", " << program.bump_state_delta_name << "), "
        << program.bump_state_param_name << "." << program.total_field_name << " + 1.0};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.step_function_name << "(" << program.scene_type_name << " " << program.scene_param_name
        << ", " << program.point_type_name << " " << program.shift_param_name
        << ", const std::array<double, 2>& " << program.extra_param_name
        << ", const std::map<double, long long>& " << program.delta_param_name << ") {\n"
        << "    " << program.point_type_name << " " << program.next_anchor_name << " = " << program.shift_anchor_function_name << "("
        << program.scene_param_name << "." << program.anchor_field_name << ", " << program.shift_param_name << ");\n"
        << "    " << program.state_type_name << " " << program.next_state_name << " = " << program.bump_state_function_name << "("
        << program.scene_param_name << "." << program.state_field_name << ", " << program.extra_param_name << ", " << program.delta_param_name << ");\n"
        << "    " << program.scene_type_name << " " << program.out_name << "{"
        << program.next_anchor_name << ", " << program.next_state_name << "};\n"
        << "    return " << program.out_name << ";\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{"
        << program.point_type_name << "{" << format_number_literal(program.base_anchor_first_value) << ", " << format_number_literal(program.base_anchor_second_value) << "}, "
        << program.state_type_name << "{std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_key) << ", " << program.base_multiset_count << "), "
        << format_number_literal(program.base_total_value) << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{"
        << format_number_literal(program.shift_first_value) << ", " << format_number_literal(program.shift_second_value) << "};\n"
        << "    " << program.scene_type_name << " " << program.first_name << " = " << program.step_function_name << "("
        << program.base_name << ", " << program.shift_name << ", std::array<double, 2>{"
        << format_number_literal(program.first_vector_first_value) << ", " << format_number_literal(program.first_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.first_multiset_key) << ", " << program.first_multiset_count << "));\n"
        << "    " << program.scene_type_name << " " << program.second_name << " = " << program.step_function_name << "("
        << program.first_name << ", " << program.shift_name << ", std::array<double, 2>{"
        << format_number_literal(program.second_vector_first_value) << ", " << format_number_literal(program.second_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.second_multiset_key) << ", " << program.second_multiset_count << "));\n"
        << "    std::cout << vf_format_num(" << program.second_name << "." << program.anchor_field_name << "." << program.point_second_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.second_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.second_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_compose_cpp(const NamedRecordSceneComposeProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count > 0) out[key] = count;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << program.point_type_name << " " << program.shift_anchor_function_name << "(" << program.point_type_name << " " << program.shift_anchor_param_name
        << ", " << program.point_type_name << " " << program.shift_anchor_shift_name << ") {\n"
        << "    return " << program.point_type_name << "{"
        << program.shift_anchor_param_name << "." << program.point_first_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_first_field_name << ", "
        << program.shift_anchor_param_name << "." << program.point_second_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_second_field_name << "};\n"
        << "}\n\n"
        << program.state_type_name << " " << program.bump_state_function_name << "(" << program.state_type_name << " " << program.bump_state_param_name
        << ", const std::array<double, 2>& " << program.bump_state_extra_name
        << ", const std::map<double, long long>& " << program.bump_state_delta_name << ") {\n"
        << "    return " << program.state_type_name << "{"
        << "vf_array_add(" << program.bump_state_param_name << "." << program.vector_field_name << ", " << program.bump_state_extra_name << "), "
        << "vf_mset_union(" << program.bump_state_param_name << "." << program.multiset_field_name << ", " << program.bump_state_delta_name << "), "
        << program.bump_state_param_name << "." << program.total_field_name << " + 1.0};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.step_function_name << "(" << program.scene_type_name << " " << program.scene_param_name
        << ", " << program.point_type_name << " " << program.shift_param_name
        << ", const std::array<double, 2>& " << program.extra_param_name
        << ", const std::map<double, long long>& " << program.delta_param_name << ") {\n"
        << "    return " << program.scene_type_name << "{"
        << program.scene_param_name << "." << program.anchor_field_name << ", "
        << program.bump_state_function_name << "(" << program.scene_param_name << "." << program.state_field_name << ", " << program.extra_param_name << ", " << program.delta_param_name << ")};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{"
        << program.point_type_name << "{" << format_number_literal(program.base_anchor_first_value) << ", " << format_number_literal(program.base_anchor_second_value) << "}, "
        << program.state_type_name << "{std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_key) << ", " << program.base_multiset_count << "), "
        << format_number_literal(program.base_total_value) << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{"
        << format_number_literal(program.shift_first_value) << ", " << format_number_literal(program.shift_second_value) << "};\n"
        << "    " << program.point_type_name << " " << program.moved_anchor_name << " = " << program.shift_anchor_function_name << "("
        << program.base_name << "." << program.anchor_field_name << ", " << program.shift_name << ");\n"
        << "    " << program.scene_type_name << " " << program.staged_name << " = " << program.step_function_name << "("
        << program.base_name << ", " << program.shift_name << ", std::array<double, 2>{"
        << format_number_literal(program.staged_vector_first_value) << ", " << format_number_literal(program.staged_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.staged_multiset_key) << ", " << program.staged_multiset_count << "));\n"
        << "    " << program.scene_type_name << " " << program.moved_name << "{"
        << program.moved_anchor_name << ", " << program.staged_name << "." << program.state_field_name << "};\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.anchor_field_name << "." << program.point_first_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_patch_cpp(const NamedRecordScenePatchProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count > 0) out[key] = count;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << program.point_type_name << " " << program.shift_anchor_function_name << "(" << program.point_type_name << " " << program.shift_anchor_param_name
        << ", " << program.point_type_name << " " << program.shift_anchor_shift_name << ") {\n"
        << "    return " << program.point_type_name << "{"
        << program.shift_anchor_param_name << "." << program.point_first_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_first_field_name << ", "
        << program.shift_anchor_param_name << "." << program.point_second_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_second_field_name << "};\n"
        << "}\n\n"
        << program.state_type_name << " " << program.bump_state_function_name << "(" << program.state_type_name << " " << program.bump_state_param_name
        << ", const std::array<double, 2>& " << program.bump_state_extra_name
        << ", const std::map<double, long long>& " << program.bump_state_delta_name << ") {\n"
        << "    return " << program.state_type_name << "{"
        << "vf_array_add(" << program.bump_state_param_name << "." << program.vector_field_name << ", " << program.bump_state_extra_name << "), "
        << "vf_mset_union(" << program.bump_state_param_name << "." << program.multiset_field_name << ", " << program.bump_state_delta_name << "), "
        << program.bump_state_param_name << "." << program.total_field_name << " + 1.0};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.move_anchor_function_name << "(" << program.scene_type_name << " " << program.move_anchor_scene_name
        << ", " << program.point_type_name << " " << program.move_anchor_shift_name << ") {\n"
        << "    return " << program.scene_type_name << "{"
        << program.shift_anchor_function_name << "(" << program.move_anchor_scene_name << "." << program.anchor_field_name << ", " << program.move_anchor_shift_name << "), "
        << program.move_anchor_scene_name << "." << program.state_field_name << "};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{"
        << program.point_type_name << "{" << format_number_literal(program.base_anchor_first_value) << ", " << format_number_literal(program.base_anchor_second_value) << "}, "
        << program.state_type_name << "{std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_key) << ", " << program.base_multiset_count << "), "
        << format_number_literal(program.base_total_value) << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{"
        << format_number_literal(program.shift_first_value) << ", " << format_number_literal(program.shift_second_value) << "};\n"
        << "    " << program.scene_type_name << " " << program.shifted_name << " = " << program.move_anchor_function_name << "("
        << program.base_name << ", " << program.shift_name << ");\n"
        << "    " << program.state_type_name << " " << program.patched_name << " = " << program.bump_state_function_name << "("
        << program.shifted_name << "." << program.state_field_name << ", std::array<double, 2>{"
        << format_number_literal(program.patched_vector_first_value) << ", " << format_number_literal(program.patched_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.patched_multiset_key) << ", " << program.patched_multiset_count << "));\n"
        << "    " << program.scene_type_name << " " << program.moved_name << "{"
        << program.shifted_name << "." << program.anchor_field_name << ", " << program.patched_name << "};\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.anchor_field_name << "." << program.point_first_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_split_cpp(const NamedRecordSceneSplitProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count > 0) out[key] = count;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << program.point_type_name << " " << program.shift_anchor_function_name << "(" << program.point_type_name << " " << program.shift_anchor_param_name
        << ", " << program.point_type_name << " " << program.shift_anchor_shift_name << ") {\n"
        << "    return " << program.point_type_name << "{"
        << program.shift_anchor_param_name << "." << program.point_first_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_first_field_name << ", "
        << program.shift_anchor_param_name << "." << program.point_second_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_second_field_name << "};\n"
        << "}\n\n"
        << program.state_type_name << " " << program.bump_state_function_name << "(" << program.state_type_name << " " << program.bump_state_param_name
        << ", const std::array<double, 2>& " << program.bump_state_extra_name
        << ", const std::map<double, long long>& " << program.bump_state_delta_name << ") {\n"
        << "    return " << program.state_type_name << "{"
        << "vf_array_add(" << program.bump_state_param_name << "." << program.vector_field_name << ", " << program.bump_state_extra_name << "), "
        << "vf_mset_union(" << program.bump_state_param_name << "." << program.multiset_field_name << ", " << program.bump_state_delta_name << "), "
        << program.bump_state_param_name << "." << program.total_field_name << " + 1.0};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.step_function_name << "(" << program.scene_type_name << " " << program.scene_param_name
        << ", " << program.point_type_name << " " << program.shift_param_name
        << ", const std::array<double, 2>& " << program.extra_param_name
        << ", const std::map<double, long long>& " << program.delta_param_name << ") {\n"
        << "    return " << program.scene_type_name << "{"
        << program.shift_anchor_function_name << "(" << program.scene_param_name << "." << program.anchor_field_name << ", " << program.shift_param_name << "), "
        << program.bump_state_function_name << "(" << program.scene_param_name << "." << program.state_field_name << ", " << program.extra_param_name << ", " << program.delta_param_name << ")};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{"
        << program.point_type_name << "{" << format_number_literal(program.base_anchor_first_value) << ", " << format_number_literal(program.base_anchor_second_value) << "}, "
        << program.state_type_name << "{std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_key) << ", " << program.base_multiset_count << "), "
        << format_number_literal(program.base_total_value) << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{"
        << format_number_literal(program.shift_first_value) << ", " << format_number_literal(program.shift_second_value) << "};\n"
        << "    " << program.scene_type_name << " " << program.staged_name << " = " << program.step_function_name << "("
        << program.base_name << ", " << program.shift_name << ", std::array<double, 2>{"
        << format_number_literal(program.staged_vector_first_value) << ", " << format_number_literal(program.staged_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.staged_multiset_key) << ", " << program.staged_multiset_count << "));\n"
        << "    " << program.point_type_name << " " << program.final_anchor_name << " = " << program.shift_anchor_function_name << "("
        << program.staged_name << "." << program.anchor_field_name << ", " << program.shift_name << ");\n"
        << "    " << program.state_type_name << " " << program.final_state_name << " = " << program.bump_state_function_name << "("
        << program.staged_name << "." << program.state_field_name << ", std::array<double, 2>{"
        << format_number_literal(program.final_vector_first_value) << ", " << format_number_literal(program.final_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.final_multiset_key) << ", " << program.final_multiset_count << "));\n"
        << "    " << program.scene_type_name << " " << program.moved_name << "{"
        << program.final_anchor_name << ", " << program.final_state_name << "};\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.anchor_field_name << "." << program.point_second_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_rebuild_cpp(const NamedRecordSceneRebuildProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count > 0) out[key] = count;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << program.point_type_name << " " << program.shift_anchor_function_name << "(" << program.point_type_name << " " << program.shift_anchor_param_name
        << ", " << program.point_type_name << " " << program.shift_anchor_shift_name << ") {\n"
        << "    return " << program.point_type_name << "{"
        << program.shift_anchor_param_name << "." << program.point_first_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_first_field_name << ", "
        << program.shift_anchor_param_name << "." << program.point_second_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_second_field_name << "};\n"
        << "}\n\n"
        << program.state_type_name << " " << program.bump_state_function_name << "(" << program.state_type_name << " " << program.bump_state_param_name
        << ", const std::array<double, 2>& " << program.bump_state_extra_name
        << ", const std::map<double, long long>& " << program.bump_state_delta_name << ") {\n"
        << "    return " << program.state_type_name << "{"
        << "vf_array_add(" << program.bump_state_param_name << "." << program.vector_field_name << ", " << program.bump_state_extra_name << "), "
        << "vf_mset_union(" << program.bump_state_param_name << "." << program.multiset_field_name << ", " << program.bump_state_delta_name << "), "
        << program.bump_state_param_name << "." << program.total_field_name << " + 1.0};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.step_function_name << "(" << program.scene_type_name << " " << program.scene_param_name
        << ", " << program.point_type_name << " " << program.shift_param_name
        << ", const std::array<double, 2>& " << program.extra_param_name
        << ", const std::map<double, long long>& " << program.delta_param_name << ") {\n"
        << "    return " << program.scene_type_name << "{"
        << program.shift_anchor_function_name << "(" << program.scene_param_name << "." << program.anchor_field_name << ", " << program.shift_param_name << "), "
        << program.bump_state_function_name << "(" << program.scene_param_name << "." << program.state_field_name << ", " << program.extra_param_name << ", " << program.delta_param_name << ")};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{"
        << program.point_type_name << "{" << format_number_literal(program.base_anchor_first_value) << ", " << format_number_literal(program.base_anchor_second_value) << "}, "
        << program.state_type_name << "{std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_key) << ", " << program.base_multiset_count << "), "
        << format_number_literal(program.base_total_value) << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{"
        << format_number_literal(program.shift_first_value) << ", " << format_number_literal(program.shift_second_value) << "};\n"
        << "    " << program.scene_type_name << " " << program.staged_name << " = " << program.step_function_name << "("
        << program.base_name << ", " << program.shift_name << ", std::array<double, 2>{"
        << format_number_literal(program.staged_vector_first_value) << ", " << format_number_literal(program.staged_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.staged_multiset_key) << ", " << program.staged_multiset_count << "));\n"
        << "    " << program.scene_type_name << " " << program.moved_anchor_name << "{"
        << program.shift_anchor_function_name << "(" << program.staged_name << "." << program.anchor_field_name << ", " << program.shift_name << "), "
        << program.staged_name << "." << program.state_field_name << "};\n"
        << "    " << program.scene_type_name << " " << program.moved_name << "{"
        << program.moved_anchor_name << "." << program.anchor_field_name << ", "
        << program.bump_state_function_name << "(" << program.moved_anchor_name << "." << program.state_field_name << ", std::array<double, 2>{"
        << format_number_literal(program.moved_vector_first_value) << ", " << format_number_literal(program.moved_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.moved_multiset_key) << ", " << program.moved_multiset_count << "))};\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.anchor_field_name << "." << program.emit_anchor_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_checkpoint_cpp(const NamedRecordSceneCheckpointProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    return std::map<double, long long>{{key, count}};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_add(std::map<double, long long> left, const std::map<double, long long>& right) {\n"
        << "    for (const auto& kv : right) left[kv.first] += kv.second;\n"
        << "    return left;\n"
        << "}\n\n"
        << program.point_type_name << " " << program.shift_anchor_function_name << "(" << program.point_type_name << " " << program.shift_anchor_param_name << ", " << program.point_type_name << " " << program.shift_anchor_shift_name << ") {\n"
        << "    return " << program.point_type_name << "{" << program.shift_anchor_param_name << "." << program.point_first_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_first_field_name
        << ", " << program.shift_anchor_param_name << "." << program.point_second_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_second_field_name << "};\n"
        << "}\n\n"
        << program.state_type_name << " " << program.bump_state_function_name << "(" << program.state_type_name << " " << program.bump_state_param_name << ", const std::array<double, 2>& " << program.bump_state_extra_name << ", const std::map<double, long long>& " << program.bump_state_delta_name << ") {\n"
        << "    return " << program.state_type_name << "{vf_array_add(" << program.bump_state_param_name << "." << program.vector_field_name << ", " << program.bump_state_extra_name << "), vf_mset_add(" << program.bump_state_param_name << "." << program.multiset_field_name << ", " << program.bump_state_delta_name << "), " << program.bump_state_param_name << "." << program.total_field_name << " + 1};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.step_function_name << "(" << program.scene_type_name << " " << program.scene_param_name << ", " << program.point_type_name << " " << program.shift_param_name << ", const std::array<double, 2>& " << program.extra_param_name << ", const std::map<double, long long>& " << program.delta_param_name << ") {\n"
        << "    return " << program.scene_type_name << "{" << program.shift_anchor_function_name << "(" << program.scene_param_name << "." << program.anchor_field_name << ", " << program.shift_param_name << "), " << program.bump_state_function_name << "(" << program.scene_param_name << "." << program.state_field_name << ", " << program.extra_param_name << ", " << program.delta_param_name << ")};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{{" << program.base_anchor_first_value << ", " << program.base_anchor_second_value << "}, {{"
        << program.base_vector_first_value << ", " << program.base_vector_second_value << "}, vf_mset_make(" << program.base_multiset_key << ", " << program.base_multiset_count << "), " << program.base_total_value << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{" << program.shift_first_value << ", " << program.shift_second_value << "};\n"
        << "    " << program.scene_type_name << " " << program.staged_name << " = " << program.step_function_name << "(" << program.base_name << ", " << program.shift_name << ", std::array<double, 2>{4, 5}, vf_mset_make(6, 2));\n"
        << "    " << program.scene_type_name << " " << program.checkpoint_name << " = " << program.staged_name << ";\n"
        << "    " << program.scene_type_name << " " << program.moved_name << " = " << program.checkpoint_name << ";\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.anchor_field_name << "." << program.emit_anchor_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_splice_cpp(const NamedRecordSceneSpliceProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    return std::map<double, long long>{{key, count}};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_add(std::map<double, long long> left, const std::map<double, long long>& right) {\n"
        << "    for (const auto& kv : right) left[kv.first] += kv.second;\n"
        << "    return left;\n"
        << "}\n\n"
        << program.point_type_name << " " << program.shift_anchor_function_name << "(" << program.point_type_name << " " << program.shift_anchor_param_name << ", " << program.point_type_name << " " << program.shift_anchor_shift_name << ") {\n"
        << "    return " << program.point_type_name << "{" << program.shift_anchor_param_name << "." << program.point_first_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_first_field_name
        << ", " << program.shift_anchor_param_name << "." << program.point_second_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_second_field_name << "};\n"
        << "}\n\n"
        << program.state_type_name << " " << program.bump_state_function_name << "(" << program.state_type_name << " " << program.bump_state_param_name << ", const std::array<double, 2>& " << program.bump_state_extra_name << ", const std::map<double, long long>& " << program.bump_state_delta_name << ") {\n"
        << "    return " << program.state_type_name << "{vf_array_add(" << program.bump_state_param_name << "." << program.vector_field_name << ", " << program.bump_state_extra_name << "), vf_mset_add(" << program.bump_state_param_name << "." << program.multiset_field_name << ", " << program.bump_state_delta_name << "), " << program.bump_state_param_name << "." << program.total_field_name << " + 1};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.move_anchor_function_name << "(" << program.scene_type_name << " " << program.move_anchor_scene_name << ", " << program.point_type_name << " " << program.move_anchor_shift_name << ") {\n"
        << "    return " << program.scene_type_name << "{" << program.shift_anchor_function_name << "(" << program.move_anchor_scene_name << "." << program.anchor_field_name << ", " << program.move_anchor_shift_name << "), " << program.move_anchor_scene_name << "." << program.state_field_name << "};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.fill_state_function_name << "(" << program.scene_type_name << " " << program.fill_state_scene_name << ", const std::array<double, 2>& " << program.fill_state_extra_name << ", const std::map<double, long long>& " << program.fill_state_delta_name << ") {\n"
        << "    return " << program.scene_type_name << "{" << program.fill_state_scene_name << "." << program.anchor_field_name << ", " << program.bump_state_function_name << "(" << program.fill_state_scene_name << "." << program.state_field_name << ", " << program.fill_state_extra_name << ", " << program.fill_state_delta_name << ")};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{{" << program.base_anchor_first_value << ", " << program.base_anchor_second_value << "}, {{"
        << program.base_vector_first_value << ", " << program.base_vector_second_value << "}, vf_mset_make(" << program.base_multiset_key << ", " << program.base_multiset_count << "), " << program.base_total_value << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{" << program.shift_first_value << ", " << program.shift_second_value << "};\n"
        << "    " << program.scene_type_name << " " << program.shifted_name << " = " << program.move_anchor_function_name << "(" << program.base_name << ", " << program.shift_name << ");\n"
        << "    " << program.scene_type_name << " " << program.filled_name << " = " << program.fill_state_function_name << "(" << program.base_name << ", std::array<double, 2>{4, 5}, vf_mset_make(6, 2));\n"
        << "    " << program.point_type_name << " " << program.final_anchor_name << " = " << program.shift_anchor_function_name << "(" << program.shifted_name << "." << program.anchor_field_name << ", " << program.shift_name << ");\n"
        << "    " << program.state_type_name << " " << program.final_state_name << " = " << program.bump_state_function_name << "(" << program.filled_name << "." << program.state_field_name << ", std::array<double, 2>{1, 1}, vf_mset_make(3, 1));\n"
        << "    " << program.scene_type_name << " " << program.moved_name << "{" << program.final_anchor_name << ", " << program.final_state_name << "};\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.anchor_field_name << "." << program.point_first_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_fanout_cpp(const NamedRecordSceneFanoutProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    return std::map<double, long long>{{key, count}};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_add(std::map<double, long long> left, const std::map<double, long long>& right) {\n"
        << "    for (const auto& kv : right) left[kv.first] += kv.second;\n"
        << "    return left;\n"
        << "}\n\n"
        << program.point_type_name << " " << program.shift_anchor_function_name << "(" << program.point_type_name << " " << program.shift_anchor_param_name << ", " << program.point_type_name << " " << program.shift_anchor_shift_name << ") {\n"
        << "    return " << program.point_type_name << "{" << program.shift_anchor_param_name << "." << program.point_first_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_first_field_name
        << ", " << program.shift_anchor_param_name << "." << program.point_second_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_second_field_name << "};\n"
        << "}\n\n"
        << program.state_type_name << " " << program.bump_state_function_name << "(" << program.state_type_name << " " << program.bump_state_param_name << ", const std::array<double, 2>& " << program.bump_state_extra_name << ", const std::map<double, long long>& " << program.bump_state_delta_name << ") {\n"
        << "    return " << program.state_type_name << "{vf_array_add(" << program.bump_state_param_name << "." << program.vector_field_name << ", " << program.bump_state_extra_name << "), vf_mset_add(" << program.bump_state_param_name << "." << program.multiset_field_name << ", " << program.bump_state_delta_name << "), " << program.bump_state_param_name << "." << program.total_field_name << " + 1};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{{" << program.base_anchor_first_value << ", " << program.base_anchor_second_value << "}, {{"
        << program.base_vector_first_value << ", " << program.base_vector_second_value << "}, vf_mset_make(" << program.base_multiset_key << ", " << program.base_multiset_count << "), " << program.base_total_value << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{" << program.shift_first_value << ", " << program.shift_second_value << "};\n"
        << "    " << program.point_type_name << " " << program.first_anchor_name << " = " << program.shift_anchor_function_name << "(" << program.base_name << "." << program.anchor_field_name << ", " << program.shift_name << ");\n"
        << "    " << program.state_type_name << " " << program.first_state_name << " = " << program.bump_state_function_name << "(" << program.base_name << "." << program.state_field_name << ", std::array<double, 2>{4, 5}, vf_mset_make(6, 2));\n"
        << "    " << program.scene_type_name << " " << program.first_name << "{" << program.first_anchor_name << ", " << program.first_state_name << "};\n"
        << "    " << program.point_type_name << " " << program.second_anchor_name << " = " << program.shift_anchor_function_name << "(" << program.first_name << "." << program.anchor_field_name << ", " << program.shift_name << ");\n"
        << "    " << program.state_type_name << " " << program.second_state_name << " = " << program.bump_state_function_name << "(" << program.first_name << "." << program.state_field_name << ", std::array<double, 2>{1, 1}, vf_mset_make(3, 1));\n"
        << "    " << program.scene_type_name << " " << program.second_name << "{" << program.second_anchor_name << ", " << program.second_state_name << "};\n"
        << "    std::cout << vf_format_num(" << program.second_name << "." << program.anchor_field_name << "." << program.point_first_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.second_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.second_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

static std::string emit_named_record_scene_overlay_cpp(const NamedRecordSceneOverlayProgram& program) {
    std::ostringstream out;
    out
        << "#include <algorithm>\n"
        << "#include <array>\n"
        << "#include <cmath>\n"
        << "#include <iomanip>\n"
        << "#include <iostream>\n"
        << "#include <map>\n"
        << "#include <sstream>\n"
        << "#include <string>\n\n"
        << "static std::string vf_format_num(double value) {\n"
        << "    if (std::isfinite(value) && std::floor(value) == value) {\n"
        << "        std::ostringstream out;\n"
        << "        out << static_cast<long long>(value);\n"
        << "        return out.str();\n"
        << "    }\n"
        << "    std::ostringstream out;\n"
        << "    out << std::setprecision(15) << value;\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "template <typename T, std::size_t N>\n"
        << "static std::string vf_format_value(const std::array<T, N>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"[\";\n"
        << "    for (std::size_t i = 0; i < N; ++i) {\n"
        << "        if (i) out << \", \";\n"
        << "        out << vf_format_num(value[i]);\n"
        << "    }\n"
        << "    out << \"]\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const std::map<double, long long>& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"{\";\n"
        << "    bool first = true;\n"
        << "    for (const auto& kv : value) {\n"
        << "        if (!first) out << \", \";\n"
        << "        first = false;\n"
        << "        out << vf_format_num(kv.first) << \":\" << kv.second;\n"
        << "    }\n"
        << "    out << \"}\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "struct " << program.point_type_name << " {\n"
        << "    double " << program.point_first_field_name << ";\n"
        << "    double " << program.point_second_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.state_type_name << " {\n"
        << "    std::array<double, 2> " << program.vector_field_name << ";\n"
        << "    std::map<double, long long> " << program.multiset_field_name << ";\n"
        << "    double " << program.total_field_name << ";\n"
        << "};\n\n"
        << "struct " << program.scene_type_name << " {\n"
        << "    " << program.point_type_name << " " << program.anchor_field_name << ";\n"
        << "    " << program.state_type_name << " " << program.state_field_name << ";\n"
        << "};\n\n"
        << "static std::string vf_format_value(const " << program.point_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.point_first_field_name << ":\" << vf_format_num(value." << program.point_first_field_name << ")\n"
        << "        << \", " << program.point_second_field_name << ":\" << vf_format_num(value." << program.point_second_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.state_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.vector_field_name << ":\" << vf_format_value(value." << program.vector_field_name << ")\n"
        << "        << \", " << program.multiset_field_name << ":\" << vf_format_value(value." << program.multiset_field_name << ")\n"
        << "        << \", " << program.total_field_name << ":\" << vf_format_num(value." << program.total_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::string vf_format_value(const " << program.scene_type_name << "& value) {\n"
        << "    std::ostringstream out;\n"
        << "    out << \"(" << program.anchor_field_name << ":\" << vf_format_value(value." << program.anchor_field_name << ")\n"
        << "        << \", " << program.state_field_name << ":\" << vf_format_value(value." << program.state_field_name << ") << \")\";\n"
        << "    return out.str();\n"
        << "}\n\n"
        << "static std::array<double, 2> vf_array_add(const std::array<double, 2>& left, const std::array<double, 2>& right) {\n"
        << "    return std::array<double, 2>{left[0] + right[0], left[1] + right[1]};\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_make(double key, long long count) {\n"
        << "    std::map<double, long long> out;\n"
        << "    if (count > 0) out[key] = count;\n"
        << "    return out;\n"
        << "}\n\n"
        << "static std::map<double, long long> vf_mset_union(const std::map<double, long long>& left, const std::map<double, long long>& right) {\n"
        << "    std::map<double, long long> out = left;\n"
        << "    for (const auto& kv : right) out[kv.first] += kv.second;\n"
        << "    return out;\n"
        << "}\n\n"
        << program.point_type_name << " " << program.shift_anchor_function_name << "(" << program.point_type_name << " " << program.shift_anchor_param_name
        << ", " << program.point_type_name << " " << program.shift_anchor_shift_name << ") {\n"
        << "    return " << program.point_type_name << "{"
        << program.shift_anchor_param_name << "." << program.point_first_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_first_field_name << ", "
        << program.shift_anchor_param_name << "." << program.point_second_field_name << " + " << program.shift_anchor_shift_name << "." << program.point_second_field_name << "};\n"
        << "}\n\n"
        << program.state_type_name << " " << program.bump_state_function_name << "(" << program.state_type_name << " " << program.bump_state_param_name
        << ", const std::array<double, 2>& " << program.bump_state_extra_name
        << ", const std::map<double, long long>& " << program.bump_state_delta_name << ") {\n"
        << "    return " << program.state_type_name << "{"
        << "vf_array_add(" << program.bump_state_param_name << "." << program.vector_field_name << ", " << program.bump_state_extra_name << "), "
        << "vf_mset_union(" << program.bump_state_param_name << "." << program.multiset_field_name << ", " << program.bump_state_delta_name << "), "
        << program.bump_state_param_name << "." << program.total_field_name << " + 1.0};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.move_anchor_function_name << "(" << program.scene_type_name << " " << program.move_anchor_scene_name
        << ", " << program.point_type_name << " " << program.move_anchor_shift_name << ") {\n"
        << "    return " << program.scene_type_name << "{"
        << program.shift_anchor_function_name << "(" << program.move_anchor_scene_name << "." << program.anchor_field_name << ", " << program.move_anchor_shift_name << "), "
        << program.move_anchor_scene_name << "." << program.state_field_name << "};\n"
        << "}\n\n"
        << program.scene_type_name << " " << program.fill_state_function_name << "(" << program.scene_type_name << " " << program.fill_state_scene_name
        << ", const std::array<double, 2>& " << program.fill_state_extra_name
        << ", const std::map<double, long long>& " << program.fill_state_delta_name << ") {\n"
        << "    return " << program.scene_type_name << "{"
        << program.fill_state_scene_name << "." << program.anchor_field_name << ", "
        << program.bump_state_function_name << "(" << program.fill_state_scene_name << "." << program.state_field_name << ", " << program.fill_state_extra_name << ", " << program.fill_state_delta_name << ")};\n"
        << "}\n\n"
        << "int main() {\n"
        << "    " << program.scene_type_name << " " << program.base_name << "{"
        << program.point_type_name << "{" << format_number_literal(program.base_anchor_first_value) << ", " << format_number_literal(program.base_anchor_second_value) << "}, "
        << program.state_type_name << "{std::array<double, 2>{" << format_number_literal(program.base_vector_first_value) << ", " << format_number_literal(program.base_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.base_multiset_key) << ", " << program.base_multiset_count << "), "
        << format_number_literal(program.base_total_value) << "}};\n"
        << "    " << program.point_type_name << " " << program.shift_name << "{"
        << format_number_literal(program.shift_first_value) << ", " << format_number_literal(program.shift_second_value) << "};\n"
        << "    " << program.scene_type_name << " " << program.shifted_name << " = " << program.move_anchor_function_name << "("
        << program.base_name << ", " << program.shift_name << ");\n"
        << "    " << program.scene_type_name << " " << program.filled_name << " = " << program.fill_state_function_name << "("
        << program.base_name << ", std::array<double, 2>{"
        << format_number_literal(program.filled_vector_first_value) << ", " << format_number_literal(program.filled_vector_second_value) << "}, "
        << "vf_mset_make(" << format_number_literal(program.filled_multiset_key) << ", " << program.filled_multiset_count << "));\n"
        << "    " << program.scene_type_name << " " << program.moved_name << "{"
        << program.shifted_name << "." << program.anchor_field_name << ", " << program.filled_name << "." << program.state_field_name << "};\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.anchor_field_name << "." << program.point_first_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_num(" << program.moved_name << "." << program.state_field_name << "." << program.total_field_name << ") << \"\\n\";\n"
        << "    std::cout << vf_format_value(" << program.moved_name << ") << \"\\n\";\n"
        << "    return 0;\n"
        << "}\n";
    return out.str();
}

int main(int argc, char** argv) {
    try {
        if (argc < 2) {
            throw std::runtime_error("usage: vf_native_parser_proto <source-or->");
        }
        std::string source;
        if (std::string(argv[1]) == "-") {
            std::ostringstream in;
            in << std::cin.rdbuf();
            source = in.str();
        } else {
            std::ifstream file(argv[1], std::ios::binary);
            if (!file) {
                throw std::runtime_error("cannot open source file");
            }
            std::ostringstream in;
            in << file.rdbuf();
            source = in.str();
        }
        Parser parser(source);
        std::cout << parser.emit_cpp();
        return 0;
    } catch (const std::exception& exc) {
        std::cerr << exc.what() << "\n";
        return 1;
    }
}
"""


def _native_parser_proto_cache_dirs() -> list[Path]:
    dirs: list[Path] = []
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        dirs.append(Path(local_app_data) / "vektorflow-native-parser-proto")
    dirs.append(Path.cwd() / ".tmp" / "vektorflow-native-parser-proto")
    dirs.append(Path(tempfile.gettempdir()) / "vektorflow-native-parser-proto")
    deduped: list[Path] = []
    seen: set[str] = set()
    for path in dirs:
        key = str(path)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(path)
    return deduped


def build_native_parser_proto() -> Path:
    source = _native_parser_proto_cpp_source()
    digest = hashlib.sha1(source.encode("utf-8")).hexdigest()[:12]
    exe_stem = f"vf_native_parser_proto_{digest}"
    last_error: OSError | None = None
    for out_dir in _native_parser_proto_cache_dirs():
        compiler_output = out_dir / f"{exe_stem}.cpp"
        exe_path = out_dir / (f"{exe_stem}.exe" if os.name == "nt" else exe_stem)
        if compiler_output.is_file() and exe_path.is_file():
            return exe_path
        try:
            return compile_cpp_source(source, out_dir, exe_name=exe_stem)
        except OSError as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise last_error
    raise CppEmitError("native parser prototype cache setup failed")


@dataclass(frozen=True)
class NativeParserProtoInput:
    source: str | None
    filename: str

    @property
    def is_file_input(self) -> bool:
        return self.source is None

    @property
    def path(self) -> Path:
        return Path(self.filename)


@dataclass(frozen=True)
class NativeParserProtoExecution:
    """Drive the current native parser prototype as one execution unit."""

    request: NativeParserProtoInput

    @cached_property
    def cpp_source(self) -> str:
        return _emit_cpp_from_native_parser_proto(self.request)

    def build(self, out_path: str | Path) -> Path:
        out_path = Path(out_path)
        compiled = compile_cpp_source(
            self.cpp_source,
            out_path.parent,
            exe_name=out_path.stem or _default_native_parser_proto_exe_name(self.request),
        )
        if compiled != out_path:
            if out_path.exists():
                out_path.unlink()
            compiled.replace(out_path)
        return out_path

    def run(self, out_dir: str | Path | None = None) -> subprocess.CompletedProcess[str]:
        exe_path = self.build(_default_native_parser_proto_run_path(self.request, out_dir))
        return subprocess.run([str(exe_path)], capture_output=True, text=True)


def _emit_cpp_from_native_parser_proto(request: NativeParserProtoInput) -> str:
    exe = build_native_parser_proto()
    if request.is_file_input:
        proc = subprocess.run([str(exe), request.filename], capture_output=True, text=True)
    else:
        proc = subprocess.run(
            [str(exe), "-"],
            input=request.source,
            capture_output=True,
            text=True,
        )
    if proc.returncode != 0:
        raise CppEmitError(proc.stderr.strip() or proc.stdout.strip() or "native parser prototype failed")
    return proc.stdout


def _default_native_parser_proto_exe_name(request: NativeParserProtoInput) -> str:
    label = request.path.stem if request.is_file_input else request.filename
    digest_source = request.filename if request.is_file_input else request.source or ""
    digest = hashlib.sha1(digest_source.encode("utf-8")).hexdigest()[:10]
    safe_label = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in label).strip("._-")
    if not safe_label:
        safe_label = "native_core_proto"
    return f"vf_np_{safe_label}_{digest}"


def _default_native_parser_proto_run_path(
    request: NativeParserProtoInput,
    out_dir: str | Path | None,
) -> Path:
    if out_dir is None:
        base_dir = Path(tempfile.gettempdir()) / "vektorflow-native-parser-runs"
    else:
        base_dir = Path(out_dir)
    exe_name = _default_native_parser_proto_exe_name(request)
    suffix = ".exe" if os.name == "nt" else ""
    return base_dir / f"{exe_name}{suffix}"


def native_parser_proto_file_execution(path: Path) -> NativeParserProtoExecution:
    return NativeParserProtoExecution(NativeParserProtoInput(source=None, filename=str(path)))


def native_parser_proto_source_execution(
    source: str,
    filename: str = "stdin.vkf",
) -> NativeParserProtoExecution:
    return NativeParserProtoExecution(NativeParserProtoInput(source=source, filename=filename))


def emit_cpp_for_native_core_file(path: Path) -> str:
    return native_parser_proto_file_execution(path).cpp_source


def emit_cpp_for_native_core_source(source: str) -> str:
    return native_parser_proto_source_execution(source).cpp_source


def emit_cpp_for_hello_native_file(path: Path) -> str:
    return emit_cpp_for_native_core_file(path)


def emit_cpp_for_hello_native_source(source: str) -> str:
    return emit_cpp_for_native_core_source(source)
