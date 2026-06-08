#include "overlay_packet_runtime.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string_view>
#include <thread>

#include <windows.h>

#include "vf/json.hpp"

namespace {

constexpr const char* kWebMessageInputSource = "webmessage";

std::string WideToUtf8(const wchar_t* w) {
    int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
    if (n <= 1)
        return {};
    std::string s(static_cast<size_t>(n), 0);
    WideCharToMultiByte(CP_UTF8, 0, w, -1, s.data(), n, nullptr, nullptr);
    s.pop_back();
    return s;
}

std::wstring Utf8ToWide(const std::string& u8) {
    if (u8.empty())
        return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, u8.data(), static_cast<int>(u8.size()), nullptr, 0);
    std::wstring w(n, 0);
    MultiByteToWideChar(CP_UTF8, 0, u8.data(), static_cast<int>(u8.size()), w.data(), n);
    return w;
}

std::string ReadFileBinary(const std::wstring& path) {
    FILE* f = nullptr;
    if (_wfopen_s(&f, path.c_str(), L"rb") != 0 || !f)
        return {};
    if (fseek(f, 0, SEEK_END) != 0) {
        fclose(f);
        return {};
    }
    long sz = ftell(f);
    if (sz <= 0 || sz > 32 * 1024 * 1024) {
        fclose(f);
        return {};
    }
    if (fseek(f, 0, SEEK_SET) != 0) {
        fclose(f);
        return {};
    }
    std::string out(static_cast<size_t>(sz), '\0');
    size_t r = fread(out.data(), 1, static_cast<size_t>(sz), f);
    fclose(f);
    if (r != static_cast<size_t>(sz))
        return {};
    return out;
}

bool TryParseWebMessageObject(const std::string& messageJsonUtf8, vf::JsonValue* rootOut) {
    if (rootOut)
        *rootOut = vf::JsonValue(nullptr);
    if (messageJsonUtf8.empty())
        return false;

    vf::JsonValue root = vf::parse_json(messageJsonUtf8);
    if (root.is_string())
        root = vf::parse_json(root.as_string());
    if (!root.is_object())
        return false;

    if (rootOut)
        *rootOut = std::move(root);
    return true;
}

std::string ObjectStringField(const vf::JsonValue::Object& object, const char* key, const std::string& fallback = {}) {
    const auto it = object.find(key);
    if (it == object.end() || !it->second.is_string())
        return fallback;
    return it->second.as_string();
}

double ObjectNumberField(const vf::JsonValue::Object& object, const char* key, double fallback) {
    const auto it = object.find(key);
    if (it == object.end() || !it->second.is_number())
        return fallback;
    return it->second.as_number();
}

int ObjectIntField(const vf::JsonValue::Object& object, const char* key, int fallback) {
    const auto it = object.find(key);
    if (it == object.end() || !it->second.is_number())
        return fallback;
    return static_cast<int>(std::round(it->second.as_number()));
}

bool ObjectBoolField(const vf::JsonValue::Object& object, const char* key, bool fallback) {
    const auto it = object.find(key);
    if (it == object.end() || !it->second.is_boolean())
        return fallback;
    return it->second.as_boolean();
}

bool EventDataStringField(const vf::JsonValue::Object& object, const char* key, std::string* out) {
    const auto dataIt = object.find("data");
    if (dataIt == object.end() || !dataIt->second.is_object())
        return false;
    const auto& dataObject = dataIt->second.as_object();
    const auto valueIt = dataObject.find(key);
    if (valueIt == dataObject.end() || !valueIt->second.is_string())
        return false;
    if (out)
        *out = valueIt->second.as_string();
    return true;
}

bool EventDataValueAsString(const vf::JsonValue::Object& object, const char* key, std::string* out) {
    const auto dataIt = object.find("data");
    if (dataIt == object.end() || !dataIt->second.is_object())
        return false;
    const auto& dataObject = dataIt->second.as_object();
    const auto valueIt = dataObject.find(key);
    if (valueIt == dataObject.end())
        return false;
    if (valueIt->second.is_string()) {
        if (out)
            *out = valueIt->second.as_string();
        return true;
    }
    if (valueIt->second.is_number()) {
        if (out)
            *out = std::to_string(valueIt->second.as_number());
        return true;
    }
    if (valueIt->second.is_boolean()) {
        if (out)
            *out = valueIt->second.as_boolean() ? "true" : "false";
        return true;
    }
    return false;
}

double ParseDoubleOr(const std::string& text, double fallback) {
    try {
        std::size_t consumed = 0;
        const double value = std::stod(text, &consumed);
        if (consumed == 0 || !std::isfinite(value))
            return fallback;
        return value;
    } catch (const std::exception&) {
        return fallback;
    }
}

int ParseIntOr(const std::string& text, int fallback) {
    try {
        std::size_t consumed = 0;
        const int value = std::stoi(text, &consumed);
        if (consumed == 0)
            return fallback;
        return value;
    } catch (const std::exception&) {
        return fallback;
    }
}

struct PlotVars {
    double u = 0.0;
    double v = 0.0;
    double w = 0.0;
    double i = 0.0;
    double j = 0.0;
    double k = 0.0;
    double t = 0.0;
};

class PlotExpressionParser {
public:
    explicit PlotExpressionParser(std::string expr, PlotVars vars = {}) : expr_(std::move(expr)), vars_(vars) {}

    double Parse() {
        pos_ = 0;
        const double value = ParseExpression();
        SkipSpaces();
        if (pos_ != expr_.size())
            throw std::runtime_error("unexpected token in expression");
        if (!std::isfinite(value))
            throw std::runtime_error("expression produced a non-finite value");
        return value;
    }

private:
    void SkipSpaces() {
        while (pos_ < expr_.size() && std::isspace(static_cast<unsigned char>(expr_[pos_])))
            ++pos_;
    }

    bool Consume(char c) {
        SkipSpaces();
        if (pos_ >= expr_.size() || expr_[pos_] != c)
            return false;
        ++pos_;
        return true;
    }

    double ParseExpression() {
        double value = ParseTerm();
        while (true) {
            if (Consume('+')) {
                value += ParseTerm();
            } else if (Consume('-')) {
                value -= ParseTerm();
            } else {
                return value;
            }
        }
    }

    double ParseTerm() {
        double value = ParsePower();
        while (true) {
            if (Consume('*')) {
                value *= ParsePower();
            } else if (Consume('/')) {
                value /= ParsePower();
            } else {
                return value;
            }
        }
    }

    double ParsePower() {
        double value = ParseUnary();
        if (Consume('^'))
            value = std::pow(value, ParsePower());
        return value;
    }

    double ParseUnary() {
        if (Consume('+'))
            return ParseUnary();
        if (Consume('-'))
            return -ParseUnary();
        return ParsePrimary();
    }

    double ParsePrimary() {
        SkipSpaces();
        if (Consume('(')) {
            const double value = ParseExpression();
            if (!Consume(')'))
                throw std::runtime_error("missing ')' in expression");
            return value;
        }
        if (pos_ < expr_.size() && (std::isdigit(static_cast<unsigned char>(expr_[pos_])) || expr_[pos_] == '.'))
            return ParseNumber();
        if (pos_ < expr_.size() && (std::isalpha(static_cast<unsigned char>(expr_[pos_])) || expr_[pos_] == '_'))
            return ParseIdentifier();
        throw std::runtime_error("expected expression value");
    }

    double ParseNumber() {
        const std::size_t start = pos_;
        while (pos_ < expr_.size() &&
               (std::isdigit(static_cast<unsigned char>(expr_[pos_])) || expr_[pos_] == '.' || expr_[pos_] == 'e' ||
                expr_[pos_] == 'E' || ((expr_[pos_] == '+' || expr_[pos_] == '-') && pos_ > start &&
                                      (expr_[pos_ - 1] == 'e' || expr_[pos_ - 1] == 'E')))) {
            ++pos_;
        }
        return std::stod(expr_.substr(start, pos_ - start));
    }

    std::string ParseIdentifierName() {
        const std::size_t start = pos_;
        while (pos_ < expr_.size() &&
               (std::isalnum(static_cast<unsigned char>(expr_[pos_])) || expr_[pos_] == '_')) {
            ++pos_;
        }
        return expr_.substr(start, pos_ - start);
    }

    double ParseIdentifier() {
        const std::string name = ParseIdentifierName();
        if (name == "x" || name == "u")
            return vars_.u;
        if (name == "y" || name == "v")
            return vars_.v;
        if (name == "w" || name == "z")
            return vars_.w;
        if (name == "i")
            return vars_.i;
        if (name == "j")
            return vars_.j;
        if (name == "k")
            return vars_.k;
        if (name == "t")
            return vars_.t;
        if (name == "pi")
            return 3.141592653589793238462643383279502884;
        if (name == "e")
            return 2.718281828459045235360287471352662498;

        if (!Consume('('))
            throw std::runtime_error("unknown identifier: " + name);
        const double arg = ParseExpression();
        if (!Consume(')'))
            throw std::runtime_error("missing ')' after function argument");
        if (name == "sin")
            return std::sin(arg);
        if (name == "cos")
            return std::cos(arg);
        if (name == "tan")
            return std::tan(arg);
        if (name == "sqrt")
            return std::sqrt(arg);
        if (name == "abs")
            return std::fabs(arg);
        if (name == "exp")
            return std::exp(arg);
        if (name == "log")
            return std::log(arg);
        throw std::runtime_error("unknown function: " + name);
    }

    std::string expr_;
    PlotVars vars_;
    std::size_t pos_ = 0;
};

bool IsKnownExpressionFunction(const std::string& name) {
    return name == "sin" || name == "cos" || name == "tan" || name == "sqrt" || name == "abs" || name == "exp" ||
           name == "log";
}

bool IsSpecialPlotVariable(const std::string& name) {
    return name == "x" || name == "y" || name == "z" || name == "u" || name == "v" || name == "w" || name == "i" ||
           name == "j" || name == "k" || name == "t";
}

std::vector<std::string> ExpressionVariables(const std::string& expr) {
    std::set<std::string> found;
    for (std::size_t i = 0; i < expr.size();) {
        if (!(std::isalpha(static_cast<unsigned char>(expr[i])) || expr[i] == '_')) {
            ++i;
            continue;
        }
        const std::size_t start = i;
        while (i < expr.size() && (std::isalnum(static_cast<unsigned char>(expr[i])) || expr[i] == '_'))
            ++i;
        const std::string name = expr.substr(start, i - start);
        if (IsSpecialPlotVariable(name))
            found.insert(name);
    }
    std::vector<std::string> ordered;
    const char* preferred[] = {"u", "v", "w", "x", "y", "z", "i", "j", "k", "t"};
    for (const char* name : preferred) {
        if (found.find(name) != found.end())
            ordered.emplace_back(name);
    }
    return ordered;
}

std::vector<std::string> PlotSampleAxes(const std::string& expr) {
    std::vector<std::string> out;
    for (const std::string& name : ExpressionVariables(expr)) {
        if (name == "t")
            continue;
        out.push_back(name);
        if (out.size() >= 2)
            break;
    }
    if (out.empty())
        out.push_back("u");
    return out;
}

std::string FunctionLabelForExpr(const std::string& expr) {
    std::vector<std::string> vars = ExpressionVariables(expr);
    if (vars.empty())
        return "$f()$";
    std::string label = "$f(";
    for (std::size_t i = 0; i < vars.size(); ++i) {
        if (i)
            label += ",";
        label += vars[i];
    }
    label += ")$";
    return label;
}

void SetVariableValue(PlotVars& vars, const std::string& name, double value) {
    if (name == "x" || name == "u") {
        vars.u = value;
    } else if (name == "y" || name == "v") {
        vars.v = value;
    } else if (name == "z" || name == "w") {
        vars.w = value;
    } else if (name == "i") {
        vars.i = value;
    } else if (name == "j") {
        vars.j = value;
    } else if (name == "k") {
        vars.k = value;
    } else if (name == "t") {
        vars.t = value;
    } else {
        vars.u = value;
    }
}

double ParseExpressionNumberOr(const std::string& text, double fallback) {
    try {
        const double value = PlotExpressionParser(text).Parse();
        return std::isfinite(value) ? value : fallback;
    } catch (const std::exception&) {
        return ParseDoubleOr(text, fallback);
    }
}

int ParseExpressionIntOr(const std::string& text, int fallback) {
    const double value = ParseExpressionNumberOr(text, static_cast<double>(fallback));
    if (!std::isfinite(value))
        return fallback;
    return static_cast<int>(std::round(value));
}

std::string LowerAscii(std::string text) {
    for (char& c : text)
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return text;
}

bool PlotModeEnabled(const std::string& text) {
    const std::string mode = LowerAscii(text);
    return mode != "none" && mode != "hide" && mode != "hidden" && mode != "0";
}

std::array<double, 4> PlotColor(const std::string& mode, const std::string& colormap, double t,
                                std::array<double, 4> constant) {
    if (LowerAscii(mode) != "distributed")
        return constant;
    t = (std::max)(0.0, (std::min)(1.0, t));
    const std::string cmap = LowerAscii(colormap);
    if (cmap == "jet") {
        const double r = (std::max)(0.0, (std::min)(1.0, 1.5 - std::fabs(4.0 * t - 3.0)));
        const double g = (std::max)(0.0, (std::min)(1.0, 1.5 - std::fabs(4.0 * t - 2.0)));
        const double b = (std::max)(0.0, (std::min)(1.0, 1.5 - std::fabs(4.0 * t - 1.0)));
        return {r, g, b, constant[3]};
    }
    return {t, 1.0 - t, 0.5 + 0.5 * std::sin(t * 6.283185307179586), constant[3]};
}

std::vector<std::string> SplitVectorExpression(const std::string& expr) {
    std::string text = expr;
    std::size_t start = 0;
    std::size_t end = text.size();
    while (start < end && std::isspace(static_cast<unsigned char>(text[start])))
        ++start;
    while (end > start && std::isspace(static_cast<unsigned char>(text[end - 1])))
        --end;
    if (end <= start + 1 || text[start] != '[' || text[end - 1] != ']')
        return {text.substr(start, end - start)};
    std::vector<std::string> parts;
    std::size_t partStart = start + 1;
    int depth = 0;
    for (std::size_t i = start + 1; i < end - 1; ++i) {
        const char c = text[i];
        if (c == '(' || c == '[')
            ++depth;
        else if (c == ')' || c == ']')
            --depth;
        else if (c == ',' && depth == 0) {
            parts.push_back(text.substr(partStart, i - partStart));
            partStart = i + 1;
        }
    }
    parts.push_back(text.substr(partStart, end - 1 - partStart));
    return parts.empty() ? std::vector<std::string>{""} : parts;
}

double VariableValue(const PlotVars& vars, const std::string& name) {
    if (name == "x" || name == "u")
        return vars.u;
    if (name == "y" || name == "v")
        return vars.v;
    if (name == "z" || name == "w")
        return vars.w;
    if (name == "i")
        return vars.i;
    if (name == "j")
        return vars.j;
    if (name == "k")
        return vars.k;
    if (name == "t")
        return vars.t;
    return vars.u;
}

std::vector<double> EvalVectorExpression(const std::string& expr, PlotVars vars) {
    std::vector<std::string> parts = SplitVectorExpression(expr);
    std::vector<double> out;
    out.reserve(parts.size());
    for (const std::string& part : parts)
        out.push_back(PlotExpressionParser(part, vars).Parse());
    return out;
}

vf::JsonValue::Array BuildCurvePlotOps(const std::string& expr, double xmin, double xmax, int count, double lineWidth,
                                       double vertexRadius) {
    count = (std::max)(2, (std::min)(count, 2000));
    if (!std::isfinite(xmin) || !std::isfinite(xmax) || xmin == xmax)
        throw std::runtime_error("invalid x range");

    const std::vector<std::string> varsUsed = ExpressionVariables(expr);
    const std::string axisName = varsUsed.empty() ? "u" : varsUsed[0];
    std::vector<std::pair<double, double>> samples;
    samples.reserve(static_cast<std::size_t>(count));
    double maxExtent = (std::max)(std::fabs(xmin), std::fabs(xmax));
    for (int i = 0; i < count; ++i) {
        const double a = count == 1 ? 0.0 : static_cast<double>(i) / static_cast<double>(count - 1);
        const double x = xmin + a * (xmax - xmin);
        PlotVars vars;
        vars.u = x;
        vars.v = 0.0;
        vars.i = static_cast<double>(i);
        vars.t = 0.0;
        const std::vector<double> value = EvalVectorExpression(expr, vars);
        const double px = value.size() >= 2 ? value[0] : VariableValue(vars, axisName);
        const double py = value.size() >= 2 ? value[1] : value[0];
        samples.emplace_back(px, py);
        maxExtent = (std::max)(maxExtent, std::fabs(px));
        maxExtent = (std::max)(maxExtent, std::fabs(py));
    }
    if (maxExtent <= 0.0 || !std::isfinite(maxExtent))
        maxExtent = 1.0;
    const double scale = 0.46 / maxExtent;

    vf::JsonValue::Array points;
    points.reserve(samples.size());
    for (const auto& sample : samples) {
        points.push_back(vf::JsonValue(vf::JsonValue::Array{
            vf::JsonValue(0.5 + sample.first * scale),
            vf::JsonValue(0.5 - sample.second * scale),
        }));
    }

    vf::JsonValue::Array ops;
    ops.push_back(vf::JsonValue(vf::JsonValue::Object{
        {"op", vf::JsonValue("polyline")},
        {"points", vf::JsonValue(points)},
        {"color", vf::JsonValue(vf::JsonValue::Array{
                      vf::JsonValue(1.0),
                      vf::JsonValue(0.58),
                      vf::JsonValue(0.10),
                      vf::JsonValue(1.0),
                  })},
        {"width", vf::JsonValue(lineWidth)},
        {"cap", vf::JsonValue("round")},
    }));

    if (vertexRadius > 0.0) {
        for (const vf::JsonValue& point : points) {
            ops.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"op", vf::JsonValue("point")},
                {"point", point},
                {"color", vf::JsonValue(vf::JsonValue::Array{
                              vf::JsonValue(1.0),
                              vf::JsonValue(0.74),
                              vf::JsonValue(0.24),
                              vf::JsonValue(0.88),
                          })},
                {"radius", vf::JsonValue(vertexRadius)},
                {"shape", vf::JsonValue("circle")},
            }));
        }
    }
    return ops;
}

vf::JsonValue::Array BuildSurfacePlotOps(const std::string& expr, double xmin, double xmax, int xCount, double ymin,
                                         double ymax, int yCount, double lineWidth) {
    xCount = (std::max)(2, (std::min)(xCount, 220));
    yCount = (std::max)(2, (std::min)(yCount, 220));
    if (!std::isfinite(xmin) || !std::isfinite(xmax) || !std::isfinite(ymin) || !std::isfinite(ymax) || xmin == xmax ||
        ymin == ymax)
        throw std::runtime_error("invalid x/y range");

    vf::JsonValue::Array points;
    points.reserve(static_cast<std::size_t>(xCount * yCount));
    double zMin = 0.0;
    double zMax = 0.0;
    bool first = true;
    for (int j = 0; j < yCount; ++j) {
        const double ay = static_cast<double>(j) / static_cast<double>(yCount - 1);
        const double y = ymin + ay * (ymax - ymin);
        for (int i = 0; i < xCount; ++i) {
            const double ax = static_cast<double>(i) / static_cast<double>(xCount - 1);
            const double x = xmin + ax * (xmax - xmin);
            PlotVars vars;
            vars.u = x;
            vars.v = y;
            vars.i = static_cast<double>(i);
            vars.j = static_cast<double>(j);
            vars.t = 0.0;
            const std::vector<double> value = EvalVectorExpression(expr, vars);
            const double px = value.size() >= 3 ? value[0] : x;
            const double py = value.size() >= 3 ? value[1] : y;
            const double z = value.size() >= 3 ? value[2] : value[0];
            points.push_back(vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(px), vf::JsonValue(py), vf::JsonValue(z)}));
            if (first) {
                zMin = zMax = z;
                first = false;
            } else {
                zMin = (std::min)(zMin, z);
                zMax = (std::max)(zMax, z);
            }
        }
    }

    vf::JsonValue::Array ops;
    ops.push_back(vf::JsonValue(vf::JsonValue::Object{
        {"op", vf::JsonValue("surface")},
        {"points", vf::JsonValue(points)},
        {"cols", vf::JsonValue(static_cast<double>(xCount))},
        {"rows", vf::JsonValue(static_cast<double>(yCount))},
        {"z_min", vf::JsonValue(zMin)},
        {"z_max", vf::JsonValue(zMax)},
        {"color", vf::JsonValue(vf::JsonValue::Array{
                      vf::JsonValue(0.24),
                      vf::JsonValue(0.56),
                      vf::JsonValue(1.0),
                      vf::JsonValue(0.96),
                  })},
        {"edge_color", vf::JsonValue(vf::JsonValue::Array{
                           vf::JsonValue(0.08),
                           vf::JsonValue(0.14),
                           vf::JsonValue(0.22),
                           vf::JsonValue(0.35),
                       })},
        {"edge_width", vf::JsonValue(lineWidth)},
    }));
    return ops;
}

constexpr std::size_t kMaxRuntimePacketHistory = 256;
constexpr std::size_t kRuntimePacketBootstrapPrefix = 3;

void CapRuntimePacketHistory(std::vector<vf::UiRuntimePacket>& packets) {
    if (packets.size() <= kMaxRuntimePacketHistory)
        return;
    const std::size_t prefix = (std::min)(kRuntimePacketBootstrapPrefix, packets.size());
    const std::size_t tail = kMaxRuntimePacketHistory - prefix;
    std::vector<vf::UiRuntimePacket> compact;
    compact.reserve(kMaxRuntimePacketHistory);
    compact.insert(compact.end(), packets.begin(), packets.begin() + prefix);
    compact.insert(compact.end(), packets.end() - tail, packets.end());
    packets = std::move(compact);
}

vf::JsonValue BuildPlotGeom(const std::string& expr, double xmin, double xmax, int xCount, double ymin, double ymax,
                            int yCount, double tMin, double tMax, int tCount, double tValue,
                            double lineWidth, double vertexRadius, const std::string& faceMode,
                            const std::string& edgeMode, const std::string& vertexMode, double edgeScale,
                            double vertexScale, const std::string& faceColormap, const std::string& edgeColormap,
                            const std::string& vertexColormap, const std::string& plotSpace) {
    const std::vector<std::string> axes = PlotSampleAxes(expr);
    const std::vector<std::string> exprVars = ExpressionVariables(expr);
    const bool hasTime = std::find(exprVars.begin(), exprVars.end(), "t") != exprVars.end();
    const bool twoDimensional = axes.size() >= 2;
    const std::string normalizedPlotSpace = LowerAscii(plotSpace);
    if (normalizedPlotSpace == "2d" && twoDimensional)
        throw std::runtime_error("2D plot frame cannot render expressions with two sampled axes; use the 3D frame");
    const bool emitFaces = twoDimensional && PlotModeEnabled(faceMode);
    const bool emitEdges = PlotModeEnabled(edgeMode);
    const bool emitVertices = PlotModeEnabled(vertexMode);
    if (!(edgeScale > 0.0))
        edgeScale = 1.0;
    if (!(vertexScale > 0.0))
        vertexScale = 1.0;
    const double scaledLineWidth = lineWidth * edgeScale;
    const double scaledVertexRadius = vertexRadius * vertexScale;
    vf::JsonValue::Array vertices;
    auto pushVertex = [&](double x, double y, double z, double nx, double ny, double nz, double r, double g, double b,
                          double a) {
        vertices.push_back(vf::JsonValue(x));
        vertices.push_back(vf::JsonValue(y));
        vertices.push_back(vf::JsonValue(z));
        vertices.push_back(vf::JsonValue(nx));
        vertices.push_back(vf::JsonValue(ny));
        vertices.push_back(vf::JsonValue(nz));
        vertices.push_back(vf::JsonValue(r));
        vertices.push_back(vf::JsonValue(g));
        vertices.push_back(vf::JsonValue(b));
        vertices.push_back(vf::JsonValue(a));
    };

    if (!twoDimensional) {
        vf::JsonValue::Array edgeIndices;
        vf::JsonValue::Array vertexIndices;
        xCount = (std::max)(2, (std::min)(xCount, 2000));
        for (int i = 0; i < xCount; ++i) {
            const double a = static_cast<double>(i) / static_cast<double>(xCount - 1);
            PlotVars vars;
            SetVariableValue(vars, axes[0], xmin + a * (xmax - xmin));
            vars.i = static_cast<double>(i);
            vars.t = tValue;
            const std::vector<double> value = EvalVectorExpression(expr, vars);
            if (normalizedPlotSpace == "2d" && value.size() >= 3)
                throw std::runtime_error("2D plot frame cannot render 3D vector expressions; use the 3D frame");
            const double axisValue = VariableValue(vars, axes[0]);
            const double x = value.size() >= 2 ? value[0] : axisValue;
            const double y = value.size() >= 2 ? value[1] : value[0];
            const double z = value.size() >= 3 ? value[2] : 0.0;
            const auto color = PlotColor(vertexMode, vertexColormap, a, PlotColor(edgeMode, edgeColormap, a, {1.0, 0.58, 0.10, 1.0}));
            pushVertex(x, y, z, 0.0, 0.0, 1.0, color[0], color[1], color[2], color[3]);
            vertexIndices.push_back(vf::JsonValue(static_cast<double>(i)));
            if (i + 1 < xCount) {
                edgeIndices.push_back(vf::JsonValue(static_cast<double>(i)));
                edgeIndices.push_back(vf::JsonValue(static_cast<double>(i + 1)));
            }
        }
        vf::JsonValue::Array meshes;
        if (emitEdges) {
            meshes.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"type", vf::JsonValue("field_mesh")},
                {"id", vf::JsonValue("dynamic_plot_edges")},
                {"topology", vf::JsonValue("line-list")},
                {"vertices", vf::JsonValue(vertices)},
                {"indices", vf::JsonValue(edgeIndices)},
                {"edge_width", vf::JsonValue(scaledLineWidth)},
                {"render_mode", vf::JsonValue("proxy_geometry")},
            }));
        }
        if (emitVertices && scaledVertexRadius > 0.0) {
            meshes.push_back(vf::JsonValue(vf::JsonValue::Object{
                {"type", vf::JsonValue("field_mesh")},
                {"id", vf::JsonValue("dynamic_plot_vertices")},
                {"topology", vf::JsonValue("point-list")},
                {"vertices", vf::JsonValue(vertices)},
                {"indices", vf::JsonValue(vertexIndices)},
                {"vertex_size", vf::JsonValue(scaledVertexRadius)},
                {"render_mode", vf::JsonValue("proxy_geometry")},
            }));
        }
        return vf::JsonValue(vf::JsonValue::Object{
            {"meshes", vf::JsonValue(meshes)},
            {"camera", vf::JsonValue(vf::JsonValue::Object{
                           {"pos", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(0.0), vf::JsonValue(-4.0), vf::JsonValue(2.6)})},
                           {"target", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(0.0), vf::JsonValue(0.0), vf::JsonValue(0.0)})},
                           {"up", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(0.0), vf::JsonValue(0.0), vf::JsonValue(1.0)})},
                           {"fov", vf::JsonValue(34.0)},
                        })},
            {"lights", vf::JsonValue(vf::JsonValue::Array{})},
            {"plot_controls", vf::JsonValue(true)},
            {"plot_kind", vf::JsonValue("curve")},
            {"plot_animate", vf::JsonValue(hasTime)},
            {"plot_t_min", vf::JsonValue(tMin)},
            {"plot_t_max", vf::JsonValue(tMax)},
            {"plot_t_count", vf::JsonValue(static_cast<double>((std::max)(2, tCount)))},
            {"unified_renderer", vf::JsonValue(true)},
        });
    }

    xCount = (std::max)(2, (std::min)(xCount, 220));
    yCount = (std::max)(2, (std::min)(yCount, 220));
    vf::JsonValue::Array faceIndices;
    vf::JsonValue::Array edgeIndices;
    vf::JsonValue::Array vertexIndices;
    for (int j = 0; j < yCount; ++j) {
        const double av = static_cast<double>(j) / static_cast<double>(yCount - 1);
        for (int i = 0; i < xCount; ++i) {
            const double au = static_cast<double>(i) / static_cast<double>(xCount - 1);
            PlotVars vars;
            SetVariableValue(vars, axes[0], xmin + au * (xmax - xmin));
            SetVariableValue(vars, axes[1], ymin + av * (ymax - ymin));
            vars.i = static_cast<double>(i);
            vars.j = static_cast<double>(j);
            vars.t = tValue;
            const std::vector<double> value = EvalVectorExpression(expr, vars);
            const double x = value.size() >= 3 ? value[0] : vars.u;
            const double y = value.size() >= 3 ? value[1] : vars.v;
            const double z = value.size() >= 3 ? value[2] : value[0];
            const double colorT = 0.5 * (au + av);
            const auto color = PlotColor(vertexMode, vertexColormap, colorT,
                               PlotColor(edgeMode, edgeColormap, colorT,
                               PlotColor(faceMode, faceColormap, colorT, {0.24, 0.56, 1.0, 1.0})));
            pushVertex(x, y, z, 0.0, 0.0, 1.0, color[0], color[1], color[2], color[3]);
            vertexIndices.push_back(vf::JsonValue(static_cast<double>(j * xCount + i)));
        }
    }
    for (int j = 0; j + 1 < yCount; ++j) {
        for (int i = 0; i + 1 < xCount; ++i) {
            const int a = j * xCount + i;
            const int b = j * xCount + i + 1;
            const int c = (j + 1) * xCount + i + 1;
            const int d = (j + 1) * xCount + i;
            faceIndices.push_back(vf::JsonValue(static_cast<double>(a)));
            faceIndices.push_back(vf::JsonValue(static_cast<double>(b)));
            faceIndices.push_back(vf::JsonValue(static_cast<double>(c)));
            faceIndices.push_back(vf::JsonValue(static_cast<double>(a)));
            faceIndices.push_back(vf::JsonValue(static_cast<double>(c)));
            faceIndices.push_back(vf::JsonValue(static_cast<double>(d)));
            if (j == 0) {
                edgeIndices.push_back(vf::JsonValue(static_cast<double>(a)));
                edgeIndices.push_back(vf::JsonValue(static_cast<double>(b)));
            }
            if (i == 0) {
                edgeIndices.push_back(vf::JsonValue(static_cast<double>(a)));
                edgeIndices.push_back(vf::JsonValue(static_cast<double>(d)));
            }
            edgeIndices.push_back(vf::JsonValue(static_cast<double>(b)));
            edgeIndices.push_back(vf::JsonValue(static_cast<double>(c)));
            edgeIndices.push_back(vf::JsonValue(static_cast<double>(d)));
            edgeIndices.push_back(vf::JsonValue(static_cast<double>(c)));
        }
    }
    vf::JsonValue::Array meshes;
    if (emitFaces) {
        meshes.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"type", vf::JsonValue("field_mesh")},
            {"id", vf::JsonValue("dynamic_plot_faces")},
            {"topology", vf::JsonValue("triangle-list")},
            {"vertices", vf::JsonValue(vertices)},
            {"indices", vf::JsonValue(faceIndices)},
            {"interpolation", vf::JsonValue(true)},
        }));
    }
    if (emitEdges) {
        meshes.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"type", vf::JsonValue("field_mesh")},
            {"id", vf::JsonValue("dynamic_plot_edges")},
            {"topology", vf::JsonValue("line-list")},
            {"vertices", vf::JsonValue(vertices)},
            {"indices", vf::JsonValue(edgeIndices)},
            {"edge_width", vf::JsonValue(scaledLineWidth)},
            {"render_mode", vf::JsonValue("proxy_geometry")},
        }));
    }
    if (emitVertices && scaledVertexRadius > 0.0) {
        meshes.push_back(vf::JsonValue(vf::JsonValue::Object{
            {"type", vf::JsonValue("field_mesh")},
            {"id", vf::JsonValue("dynamic_plot_vertices")},
            {"topology", vf::JsonValue("point-list")},
            {"vertices", vf::JsonValue(vertices)},
            {"indices", vf::JsonValue(vertexIndices)},
            {"vertex_size", vf::JsonValue(scaledVertexRadius)},
            {"render_mode", vf::JsonValue("proxy_geometry")},
        }));
    }
    return vf::JsonValue(vf::JsonValue::Object{
        {"meshes", vf::JsonValue(meshes)},
        {"camera", vf::JsonValue(vf::JsonValue::Object{
                       {"pos", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(2.6), vf::JsonValue(-4.2), vf::JsonValue(2.8)})},
                       {"target", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(0.0), vf::JsonValue(0.0), vf::JsonValue(0.0)})},
                       {"up", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(0.0), vf::JsonValue(0.0), vf::JsonValue(1.0)})},
                       {"fov", vf::JsonValue(34.0)},
                   })},
        {"lights", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(vf::JsonValue::Object{
                       {"kind", vf::JsonValue("point")},
                       {"pos", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(3.0), vf::JsonValue(-4.0), vf::JsonValue(5.0)})},
                       {"color", vf::JsonValue(vf::JsonValue::Array{vf::JsonValue(1.0), vf::JsonValue(0.96), vf::JsonValue(0.88), vf::JsonValue(1.0)})},
                       {"intensity", vf::JsonValue(42.0)},
                       {"range", vf::JsonValue(12.0)},
                    })})},
        {"ambient", vf::JsonValue(0.18)},
        {"plot_controls", vf::JsonValue(true)},
        {"plot_kind", vf::JsonValue("surface")},
        {"plot_animate", vf::JsonValue(hasTime)},
        {"plot_t_min", vf::JsonValue(tMin)},
        {"plot_t_max", vf::JsonValue(tMax)},
        {"plot_t_count", vf::JsonValue(static_cast<double>((std::max)(2, tCount)))},
        {"unified_renderer", vf::JsonValue(true)},
    });
}

vf::JsonValue WithPlotMeshIdSuffix(vf::JsonValue meshValue, const std::string& suffix) {
    if (!meshValue.is_object())
        return meshValue;
    auto& object = meshValue.as_object();
    const std::string id = ObjectStringField(object, "id", "dynamic_plot");
    object["id"] = vf::JsonValue(id + suffix);
    return meshValue;
}

vf::JsonValue::Array PlotGeomMeshes(const vf::JsonValue& geomValue, const std::string& suffix) {
    vf::JsonValue::Array out;
    if (!geomValue.is_object())
        return out;
    const auto& object = geomValue.as_object();
    const auto meshesIt = object.find("meshes");
    if (meshesIt == object.end() || !meshesIt->second.is_array())
        return out;
    for (const vf::JsonValue& mesh : meshesIt->second.as_array())
        out.push_back(WithPlotMeshIdSuffix(mesh, suffix));
    return out;
}

vf::JsonValue MergePlotGeomMeshes(vf::JsonValue geomValue, const vf::JsonValue::Array& committedMeshes,
                                  const std::string& currentSuffix) {
    vf::JsonValue::Array meshes;
    for (const vf::JsonValue& mesh : committedMeshes)
        meshes.push_back(mesh);
    const vf::JsonValue::Array currentMeshes = PlotGeomMeshes(geomValue, currentSuffix);
    for (const vf::JsonValue& mesh : currentMeshes)
        meshes.push_back(mesh);
    if (geomValue.is_object())
        geomValue.as_object()["meshes"] = vf::JsonValue(meshes);
    return geomValue;
}

std::string ReplaceCounterVars(const std::string& text, const std::map<std::string, long long>& counters) {
    std::string out;
    for (std::size_t i = 0; i < text.size();) {
        if (text[i] == '{') {
            const std::size_t end = text.find('}', i + 1);
            if (end != std::string::npos && end > i + 1) {
                const std::string name = text.substr(i + 1, end - i - 1);
                const auto it = counters.find(name);
                if (it != counters.end()) {
                    out += std::to_string(it->second);
                    i = end + 1;
                    continue;
                }
            }
        }
        if (text[i] != '$' || i + 1 >= text.size() ||
            !((text[i + 1] >= 'A' && text[i + 1] <= 'Z') || (text[i + 1] >= 'a' && text[i + 1] <= 'z') ||
              text[i + 1] == '_')) {
            out.push_back(text[i++]);
            continue;
        }
        std::size_t j = i + 2;
        while (j < text.size() &&
               ((text[j] >= 'A' && text[j] <= 'Z') || (text[j] >= 'a' && text[j] <= 'z') ||
                (text[j] >= '0' && text[j] <= '9') || text[j] == '_')) {
            ++j;
        }
        const std::string name = text.substr(i + 1, j - i - 1);
        const auto it = counters.find(name);
        if (it != counters.end())
            out += std::to_string(it->second);
        i = j;
    }
    return out;
}

}  // namespace

std::wstring OverlayPacketRuntime::RuntimePacketDefaultPath(const std::wstring& webRootW) {
    if (webRootW.empty())
        return {};
    return webRootW + L"\\vf-runtime-packets.json";
}

void OverlayPacketRuntime::SetInputEventSink(InputEventSink inputEventSink) {
    std::lock_guard<std::mutex> lock(input_event_sink_mutex_);
    input_event_sink_ = std::move(inputEventSink);
}

void OverlayPacketRuntime::SetSocketHttpResponseSink(SocketHttpResponseSink responseSink) {
    std::lock_guard<std::mutex> lock(socket_response_sink_mutex_);
    socket_http_response_sink_ = std::move(responseSink);
}

void OverlayPacketRuntime::SetLogSink(LogSink logSink) {
    std::lock_guard<std::mutex> lock(log_sink_mutex_);
    log_sink_ = std::move(logSink);
}

std::vector<vf::UiRuntimePacket> OverlayPacketRuntime::ParseRuntimePackets(const std::string& jsonUtf8) {
    const vf::JsonValue root = vf::parse_json(jsonUtf8);
    if (root.is_array()) {
        return vf::ParseUiRuntimePackets(root);
    }
    if (root.is_object()) {
        const auto& object = root.as_object();
        const auto explicitPackets = object.find("packets");
        if (explicitPackets != object.end() && explicitPackets->second.is_array()) {
            return vf::ParseUiRuntimePackets(explicitPackets->second);
        }
        const auto kind = object.find("kind");
        if (kind != object.end() && kind->second.is_string()) {
            return {vf::ParseUiRuntimePacket(root)};
        }
    }
    throw std::runtime_error("expected packet array, object with packets[], or single packet object");
}

bool OverlayPacketRuntime::NormalizeRuntimePacketContractJson(const std::string& jsonUtf8, std::string* packetsJsonOut,
                                                              int* packetCountOut, std::string* errorOut) {
    if (packetsJsonOut)
        packetsJsonOut->clear();
    if (packetCountOut)
        *packetCountOut = 0;
    if (errorOut)
        errorOut->clear();
    if (jsonUtf8.empty()) {
        if (errorOut)
            *errorOut = "empty body";
        return false;
    }

    try {
        const std::vector<vf::UiRuntimePacket> packets = ParseRuntimePackets(jsonUtf8);
        if (packetsJsonOut)
            *packetsJsonOut = vf::SerializeUiRuntimePackets(packets, -1);
        if (packetCountOut)
            *packetCountOut = static_cast<int>(packets.size());
        return true;
    } catch (const std::exception& ex) {
        if (errorOut)
            *errorOut = ex.what();
        return false;
    }
}

bool OverlayPacketRuntime::TryExtractRuntimePacketPathOverride(const std::string& bodyUtf8, std::wstring* pathOut) {
    if (pathOut)
        pathOut->clear();
    if (bodyUtf8.empty())
        return false;
    try {
        const vf::JsonValue root = vf::parse_json(bodyUtf8);
        if (!root.is_object())
            return false;
        const auto& object = root.as_object();
        const auto it = object.find("path");
        if (it == object.end() || !it->second.is_string() || it->second.as_string().empty())
            return false;
        if (pathOut)
            *pathOut = Utf8ToWide(it->second.as_string());
        return true;
    } catch (const std::exception&) {
        return false;
    }
}

OverlayPacketRuntime::SnapshotState& OverlayPacketRuntime::MutableState(Channel channel) {
    return channel == Channel::Runtime ? runtime_state_ : input_state_;
}

const OverlayPacketRuntime::SnapshotState& OverlayPacketRuntime::ReadOnlyState(Channel channel) const {
    return channel == Channel::Runtime ? runtime_state_ : input_state_;
}

void OverlayPacketRuntime::SetSnapshotState(Channel channel, const std::string& packetsJsonUtf8, int packetCount,
                                            const char* sourceUtf8, const std::wstring& pathW,
                                            const std::string& errorUtf8) {
    SnapshotState& state = MutableState(channel);
    std::lock_guard<std::mutex> lock(state.mutex);
    state.packets_json_utf8 = packetsJsonUtf8;
    state.packet_count = packetCount;
    state.source_utf8 = sourceUtf8 ? sourceUtf8 : "unknown";
    state.path_w = pathW;
    state.error_utf8 = errorUtf8;
    state.auto_refresh_from_file = (channel == Channel::Runtime && state.source_utf8 == "file");
    try {
        state.packets_cache = ParseRuntimePackets(packetsJsonUtf8);
        unsigned long long nextSeq = 1;
        for (const vf::UiRuntimePacket& packet : state.packets_cache) {
            if (packet.seq >= nextSeq)
                nextSeq = packet.seq + 1;
        }
        state.next_seq = nextSeq;
    } catch (const std::exception&) {
        state.packets_cache.clear();
        state.next_seq = 1;
    }
    ++state.revision;
}

void OverlayPacketRuntime::SetRuntimePacketSnapshot(const std::string& packetsJsonUtf8, int packetCount,
                                                    const char* sourceUtf8, const std::wstring& pathW,
                                                    const std::string& errorUtf8) {
    SetSnapshotState(Channel::Runtime, packetsJsonUtf8, packetCount, sourceUtf8, pathW, errorUtf8);
}

bool OverlayPacketRuntime::InitializeHostBindingsForWebRoot(const std::wstring& webRootW, LogSink logSink,
                                                            InputEventSink inputEventSink,
                                                            SocketHttpResponseSink socketHttpResponseSink,
                                                            std::string* errorOut) {
    SetLogSink(std::move(logSink));
    SetInputEventSink(std::move(inputEventSink));
    SetSocketHttpResponseSink(std::move(socketHttpResponseSink));
    return InitializeRuntimePacketSnapshot(webRootW, errorOut);
}

bool OverlayPacketRuntime::InitializeForWebRoot(const std::wstring& webRootW, LogSink logSink, std::string* errorOut) {
    SetLogSink(std::move(logSink));
    return InitializeRuntimePacketSnapshot(webRootW, errorOut);
}

bool OverlayPacketRuntime::InitializeRuntimePacketSnapshot(const std::wstring& webRootW, std::string* errorOut) {
    const std::wstring pathW = RuntimePacketDefaultPath(webRootW);
    SetRuntimePacketSnapshot("[]", 0, "empty", pathW, "");
    std::string eventProgramError;
    LoadEventProgramFile(webRootW.empty() ? L"" : webRootW + L"\\vf-event-program.json", &eventProgramError);
    if (errorOut)
        errorOut->clear();
    return true;
}

bool OverlayPacketRuntime::LoadEventProgramFile(const std::wstring& pathW, std::string* errorOut) {
    if (errorOut)
        errorOut->clear();
    if (pathW.empty())
        return true;
    const std::string text = ReadFileBinary(pathW);
    std::vector<EventRule> rules;
    if (!text.empty()) {
        try {
            const vf::JsonValue root = vf::parse_json(text);
            if (!root.is_object())
                throw std::runtime_error("event program must be a JSON object");
            const auto& object = root.as_object();
            const auto rulesIt = object.find("rules");
            if (rulesIt != object.end()) {
                if (!rulesIt->second.is_array())
                    throw std::runtime_error("event program rules must be an array");
                for (const vf::JsonValue& ruleValue : rulesIt->second.as_array()) {
                    if (!ruleValue.is_object())
                        throw std::runtime_error("event program rule must be an object");
                    const auto& ruleObject = ruleValue.as_object();
                    EventRule rule;
                    rule.event = ObjectStringField(ruleObject, "event");
                    rule.frame_id = ObjectStringField(ruleObject, "frame_id");
                    rule.widget_id = ObjectStringField(ruleObject, "widget_id");
                    const auto whenIt = ruleObject.find("when");
                    if (whenIt != ruleObject.end()) {
                        if (!whenIt->second.is_object())
                            throw std::runtime_error("event program rule when must be an object");
                        rule.when_text = ObjectStringField(whenIt->second.as_object(), "text");
                    }
                    const auto actionsIt = ruleObject.find("actions");
                    if (actionsIt != ruleObject.end()) {
                        if (!actionsIt->second.is_array())
                            throw std::runtime_error("event program actions must be an array");
                        for (const vf::JsonValue& actionValue : actionsIt->second.as_array()) {
                            if (!actionValue.is_object())
                                throw std::runtime_error("event program action must be an object");
                            const auto& actionObject = actionValue.as_object();
                            EventAction action;
                            action.op = ObjectStringField(actionObject, "op");
                            action.name = ObjectStringField(actionObject, "name");
                            action.target = ObjectStringField(actionObject, "target");
                            action.panel_widget = ObjectStringField(actionObject, "panel_widget", action.panel_widget);
                            action.plot_space = ObjectStringField(actionObject, "plot_space", action.plot_space);
                            action.text = ObjectStringField(actionObject, "text");
                            action.expr_widget = ObjectStringField(actionObject, "expr_widget");
                            action.min_widget = ObjectStringField(actionObject, "min_widget");
                            action.max_widget = ObjectStringField(actionObject, "max_widget");
                            action.count_widget = ObjectStringField(actionObject, "count_widget");
                            action.y_min_widget = ObjectStringField(actionObject, "y_min_widget");
                            action.y_max_widget = ObjectStringField(actionObject, "y_max_widget");
                            action.y_count_widget = ObjectStringField(actionObject, "y_count_widget");
                            action.t_min_widget = ObjectStringField(actionObject, "t_min_widget");
                            action.t_max_widget = ObjectStringField(actionObject, "t_max_widget");
                            action.t_count_widget = ObjectStringField(actionObject, "t_count_widget");
                            action.t_value_widget = ObjectStringField(actionObject, "t_value_widget");
                            action.face_widget = ObjectStringField(actionObject, "face_widget");
                            action.edge_widget = ObjectStringField(actionObject, "edge_widget");
                            action.vertex_widget = ObjectStringField(actionObject, "vertex_widget");
                            action.edge_scale_widget = ObjectStringField(actionObject, "edge_scale_widget");
                            action.vertex_scale_widget = ObjectStringField(actionObject, "vertex_scale_widget");
                            action.face_colormap_widget = ObjectStringField(actionObject, "face_colormap_widget");
                            action.edge_colormap_widget = ObjectStringField(actionObject, "edge_colormap_widget");
                            action.vertex_colormap_widget = ObjectStringField(actionObject, "vertex_colormap_widget");
                            action.face_mode = ObjectStringField(actionObject, "face_mode", action.face_mode);
                            action.edge_mode = ObjectStringField(actionObject, "edge_mode", action.edge_mode);
                            action.vertex_mode = ObjectStringField(actionObject, "vertex_mode", action.vertex_mode);
                            action.face_colormap = ObjectStringField(actionObject, "face_colormap", action.face_colormap);
                            action.edge_colormap = ObjectStringField(actionObject, "edge_colormap", action.edge_colormap);
                            action.vertex_colormap = ObjectStringField(actionObject, "vertex_colormap", action.vertex_colormap);
                            action.commit_plot = ObjectBoolField(actionObject, "commit_plot", action.commit_plot);
                            action.min_value = ObjectNumberField(actionObject, "min", action.min_value);
                            action.max_value = ObjectNumberField(actionObject, "max", action.max_value);
                            action.count_value = ObjectIntField(actionObject, "count", action.count_value);
                            action.y_min_value = ObjectNumberField(actionObject, "y_min", action.y_min_value);
                            action.y_max_value = ObjectNumberField(actionObject, "y_max", action.y_max_value);
                            action.y_count_value = ObjectIntField(actionObject, "y_count", action.y_count_value);
                            action.t_min_value = ObjectNumberField(actionObject, "t_min", action.t_min_value);
                            action.t_max_value = ObjectNumberField(actionObject, "t_max", action.t_max_value);
                            action.t_count_value = ObjectIntField(actionObject, "t_count", action.t_count_value);
                            action.line_width = ObjectNumberField(actionObject, "line_width", action.line_width);
                            action.vertex_radius = ObjectNumberField(actionObject, "vertex_radius", action.vertex_radius);
                            const auto opsIt = actionObject.find("ops");
                            if (opsIt != actionObject.end()) {
                                if (!opsIt->second.is_array())
                                    throw std::runtime_error("event program action ops must be an array");
                                action.ops = opsIt->second.as_array();
                            }
                            const auto stateIt = actionObject.find("state");
                            if (stateIt != actionObject.end()) {
                                if (!stateIt->second.is_object())
                                    throw std::runtime_error("event program action state must be an object");
                                action.state = stateIt->second.as_object();
                            }
                            rule.actions.push_back(std::move(action));
                        }
                    }
                    if (!rule.event.empty())
                        rules.push_back(std::move(rule));
                }
            }
        } catch (const std::exception& ex) {
            if (errorOut)
                *errorOut = ex.what();
            Log("Event program load failed: " + std::string(ex.what()));
            return false;
        }
    }
    {
        std::lock_guard<std::mutex> lock(event_program_mutex_);
        event_rules_ = std::move(rules);
        event_counters_.clear();
        event_values_.clear();
        plot_committed_meshes_.clear();
    }
    if (!event_rules_.empty())
        Log("Event program loaded: rules=" + std::to_string(event_rules_.size()));
    return true;
}

std::string OverlayPacketRuntime::BuildUiRuntimePacketSnapshotResponseJson(const SnapshotState& state, bool includePath) {
    vf::JsonValue::Object object{
        {"ok", vf::JsonValue(true)},
        {"source", vf::JsonValue(state.source_utf8)},
        {"revision", vf::JsonValue(static_cast<double>(state.revision))},
        {"packetCount", vf::JsonValue(static_cast<double>(state.packet_count))},
    };
    if (includePath) {
        if (state.path_w.empty()) {
            object.emplace("path", vf::JsonValue(nullptr));
        } else {
            object.emplace("path", vf::JsonValue(WideToUtf8(state.path_w.c_str())));
        }
    }
    if (state.error_utf8.empty()) {
        object.emplace("error", vf::JsonValue(nullptr));
    } else {
        object.emplace("error", vf::JsonValue(state.error_utf8));
    }
    try {
        object.emplace("packets",
                       state.packets_json_utf8.empty() ? vf::JsonValue(vf::JsonValue::Array{})
                                                       : vf::parse_json(state.packets_json_utf8));
    } catch (const std::exception&) {
        object.emplace("packets", vf::JsonValue(vf::JsonValue::Array{}));
    }
    return vf::json_stringify(vf::JsonValue(object), -1);
}

std::string OverlayPacketRuntime::BuildErrorResponseJson(const std::string& errorUtf8, const std::wstring* pathW) {
    vf::JsonValue::Object object{
        {"ok", vf::JsonValue(false)},
        {"error", vf::JsonValue(errorUtf8)},
    };
    if (pathW) {
        if (pathW->empty()) {
            object.emplace("path", vf::JsonValue(nullptr));
        } else {
            object.emplace("path", vf::JsonValue(WideToUtf8(pathW->c_str())));
        }
    }
    return vf::json_stringify(vf::JsonValue(object), -1);
}

bool OverlayPacketRuntime::LoadRuntimePacketFileIntoSnapshot(const std::wstring& pathW, std::string* errorOut) {
    if (errorOut)
        errorOut->clear();
    if (pathW.empty()) {
        if (errorOut)
            *errorOut = "runtime packet path is empty";
        return false;
    }
    std::string fileJson = ReadFileBinary(pathW);
    if (fileJson.empty()) {
        if (errorOut)
            *errorOut = "runtime packet file missing or empty";
        return false;
    }

    std::string packetsJson;
    std::string normalizeError;
    int packetCount = 0;
    if (!NormalizeRuntimePacketContractJson(fileJson, &packetsJson, &packetCount, &normalizeError)) {
        if (errorOut)
            *errorOut = normalizeError;
        return false;
    }

    SetSnapshotState(Channel::Runtime, packetsJson, packetCount, "file", pathW, "");
    Log("Runtime packets loaded from file: count=" + std::to_string(packetCount) + " path=" + WideToUtf8(pathW.c_str()));
    return true;
}

bool OverlayPacketRuntime::RefreshRuntimePacketFileSnapshotIfConfigured(std::string* errorOut) {
    if (errorOut)
        errorOut->clear();

    std::wstring pathW;
    std::string sourceUtf8;
    {
        const SnapshotState& state = ReadOnlyState(Channel::Runtime);
        std::lock_guard<std::mutex> lock(state.mutex);
        pathW = state.path_w;
        sourceUtf8 = state.source_utf8;
    }

    bool autoRefresh = false;
    {
        const SnapshotState& state = ReadOnlyState(Channel::Runtime);
        std::lock_guard<std::mutex> lock(state.mutex);
        autoRefresh = state.auto_refresh_from_file;
    }

    if (pathW.empty() || sourceUtf8 != "file" || !autoRefresh) {
        return true;
    }

    std::string fileJson = ReadFileBinary(pathW);
    if (fileJson.empty()) {
        const std::string error = "runtime packet file missing or empty";
        if (errorOut)
            *errorOut = error;
        SetRuntimePacketSnapshot("[]", 0, "file", pathW, error);
        return false;
    }

    std::string packetsJson;
    std::string normalizeError;
    int packetCount = 0;
    if (!NormalizeRuntimePacketContractJson(fileJson, &packetsJson, &packetCount, &normalizeError)) {
        if (errorOut)
            *errorOut = normalizeError;
        SetRuntimePacketSnapshot("[]", 0, "file", pathW, normalizeError);
        Log("Runtime packet file refresh failed: " + normalizeError + " path=" + WideToUtf8(pathW.c_str()));
        return false;
    }

    bool changed = false;
    {
        SnapshotState& state = MutableState(Channel::Runtime);
        std::lock_guard<std::mutex> lock(state.mutex);
        changed = state.packets_json_utf8 != packetsJson || state.packet_count != packetCount || !state.error_utf8.empty();
        if (changed) {
            state.packets_json_utf8 = packetsJson;
            state.packet_count = packetCount;
            state.source_utf8 = "file";
            state.path_w = pathW;
            state.error_utf8.clear();
            state.auto_refresh_from_file = true;
            try {
                state.packets_cache = ParseRuntimePackets(packetsJson);
                unsigned long long nextSeq = 1;
                for (const vf::UiRuntimePacket& packet : state.packets_cache) {
                    if (packet.seq >= nextSeq)
                        nextSeq = packet.seq + 1;
                }
                state.next_seq = nextSeq;
            } catch (const std::exception&) {
                state.packets_cache.clear();
                state.next_seq = 1;
            }
            ++state.revision;
        }
    }

    if (changed) {
        Log("Runtime packets refreshed from file: count=" + std::to_string(packetCount) + " path=" +
            WideToUtf8(pathW.c_str()));
    }
    return true;
}

bool OverlayPacketRuntime::AppendRuntimePacket(vf::UiRuntimePacket packet, const char* sourceUtf8,
                                               std::string* errorOut) {
    if (errorOut)
        errorOut->clear();
    try {
        SnapshotState& state = MutableState(Channel::Runtime);
        std::lock_guard<std::mutex> lock(state.mutex);
        packet.seq = state.next_seq++;
        if (state.packets_cache.empty() && !state.packets_json_utf8.empty() && state.packets_json_utf8 != "[]")
            state.packets_cache = ParseRuntimePackets(state.packets_json_utf8);
        state.packets_cache.push_back(std::move(packet));
        CapRuntimePacketHistory(state.packets_cache);
        state.packets_json_utf8 = vf::SerializeUiRuntimePackets(state.packets_cache, -1);
        state.packet_count = static_cast<int>(state.packets_cache.size());
        state.source_utf8 = sourceUtf8 ? sourceUtf8 : "native-event-program";
        state.error_utf8.clear();
        ++state.revision;
        return true;
    } catch (const std::exception& ex) {
        if (errorOut)
            *errorOut = ex.what();
        return false;
    }
}

void OverlayPacketRuntime::SchedulePlotBuild(EventAction action, std::string frameId, std::string expr, double minValue,
                                             double maxValue, int countValue, double yMinValue, double yMaxValue,
                                             int yCountValue, double tMinValue, double tMaxValue, int tCountValue,
                                             double tValue, std::string faceMode, std::string edgeMode,
                                             std::string vertexMode, double edgeScale, double vertexScale,
                                             std::string faceColormap, std::string edgeColormap,
                                             std::string vertexColormap, long long requestId,
                                             std::string sourceUtf8) {
    std::thread([this, action = std::move(action), frameId = std::move(frameId), expr = std::move(expr), minValue,
                 maxValue, countValue, yMinValue, yMaxValue, yCountValue, tMinValue, tMaxValue, tCountValue, tValue,
                 faceMode = std::move(faceMode), edgeMode = std::move(edgeMode), vertexMode = std::move(vertexMode), edgeScale, vertexScale,
                 faceColormap = std::move(faceColormap), edgeColormap = std::move(edgeColormap),
                 vertexColormap = std::move(vertexColormap), requestId, sourceUtf8 = std::move(sourceUtf8)]() mutable {
        vf::JsonValue::Object framePatch;
        vf::JsonValue::Object displayGeomPatch;
        vf::JsonValue::Object displayFramesPatch;
        try {
            const bool updatesControls = action.panel_widget == "plot_panel";
            vf::JsonValue currentGeom =
                BuildPlotGeom(expr, minValue, maxValue, countValue, yMinValue, yMaxValue, yCountValue,
                              tMinValue, tMaxValue, tCountValue, tValue,
                              action.line_width, action.vertex_radius, faceMode, edgeMode, vertexMode,
                              edgeScale, vertexScale, faceColormap, edgeColormap, vertexColormap, action.plot_space);
            const std::string targetKey = action.target;
            {
                std::lock_guard<std::mutex> lock(event_program_mutex_);
                const auto requestIt = event_counters_.find(targetKey + ".plot_request");
                if (!action.commit_plot &&
                    (requestIt == event_counters_.end() || requestIt->second != requestId)) {
                    return;
                }
                if (action.commit_plot) {
                    const long long plotIndex = ++event_counters_[targetKey + ".plot"];
                    vf::JsonValue::Array committedNow =
                        PlotGeomMeshes(currentGeom, "_plot_" + std::to_string(plotIndex));
                    vf::JsonValue::Array& committed = plot_committed_meshes_[targetKey];
                    for (const vf::JsonValue& mesh : committedNow)
                        committed.push_back(mesh);
                    vf::JsonValue committedOnly = currentGeom;
                    if (committedOnly.is_object())
                        committedOnly.as_object()["meshes"] = vf::JsonValue(committed);
                    displayGeomPatch[targetKey] = committedOnly;
                } else {
                    displayGeomPatch[targetKey] =
                        MergePlotGeomMeshes(currentGeom, plot_committed_meshes_[targetKey], "_preview");
                }
            }
            displayFramesPatch[action.target] = vf::JsonValue(vf::JsonValue::Array{});
            if (updatesControls) {
                framePatch["expr_label"] = vf::JsonValue(vf::JsonValue::Object{
                    {"text", vf::JsonValue(FunctionLabelForExpr(expr))},
                });
                const std::vector<std::string> axes = PlotSampleAxes(expr);
                const std::vector<std::string> exprVars = ExpressionVariables(expr);
                const bool hasSecondAxis = axes.size() >= 2;
                const bool hasTime = std::find(exprVars.begin(), exprVars.end(), "t") != exprVars.end();
                framePatch["x_name"] = vf::JsonValue(vf::JsonValue::Object{{"text", vf::JsonValue(axes.empty() ? "x" : axes[0])}});
                framePatch["y_name"] = vf::JsonValue(vf::JsonValue::Object{{"text", vf::JsonValue(hasSecondAxis ? axes[1] : "y")}, {"visible", vf::JsonValue(hasSecondAxis)}});
                framePatch["y_min"] = vf::JsonValue(vf::JsonValue::Object{{"visible", vf::JsonValue(hasSecondAxis)}});
                framePatch["y_max"] = vf::JsonValue(vf::JsonValue::Object{{"visible", vf::JsonValue(hasSecondAxis)}});
                framePatch["y_count"] = vf::JsonValue(vf::JsonValue::Object{{"visible", vf::JsonValue(hasSecondAxis)}});
                framePatch["t_name"] = vf::JsonValue(vf::JsonValue::Object{{"visible", vf::JsonValue(hasTime)}});
                framePatch["t_min"] = vf::JsonValue(vf::JsonValue::Object{{"visible", vf::JsonValue(hasTime)}});
                framePatch["t_max"] = vf::JsonValue(vf::JsonValue::Object{{"visible", vf::JsonValue(hasTime)}});
                framePatch["t_count"] = vf::JsonValue(vf::JsonValue::Object{{"visible", vf::JsonValue(hasTime)}});
                framePatch["status_line"] = vf::JsonValue(vf::JsonValue::Object{
                    {"text", vf::JsonValue(action.commit_plot ? ("added: " + expr) : ("preview: " + expr))},
                });
            }
        } catch (const std::exception& ex) {
            if (action.target == frameId) {
                framePatch["status_line"] = vf::JsonValue(vf::JsonValue::Object{
                    {"text", vf::JsonValue(std::string("plot error: ") + ex.what())},
                });
            }
        }

        std::string error;
        if (!framePatch.empty()) {
            vf::UiRuntimePacket packet;
            packet.kind = vf::UiRuntimePacketKind::UiStateReplace;
            packet.payload = vf::UiStateReplacePacketPayload{vf::JsonValue::Object{
                {frameId, vf::JsonValue(framePatch)},
            }};
            if (!AppendRuntimePacket(std::move(packet), sourceUtf8.c_str(), &error) && !error.empty())
                Log("Async plot state append failed: " + error);
        }
        if (!displayFramesPatch.empty() || !displayGeomPatch.empty()) {
            vf::UiRuntimePacket packet;
            packet.kind = vf::UiRuntimePacketKind::DisplayReplace;
            packet.payload = vf::DisplayReplacePacketPayload{vf::JsonValue::Object{
                {"screen", vf::JsonValue(vf::JsonValue::Array{})},
                {"frames", vf::JsonValue(displayFramesPatch)},
                {"geom", vf::JsonValue(displayGeomPatch)},
            }};
            if (!AppendRuntimePacket(std::move(packet), sourceUtf8.c_str(), &error) && !error.empty())
                Log("Async plot display append failed: " + error);
        }
    }).detach();
}

bool OverlayPacketRuntime::ExecuteEventProgramForInputEvent(const std::string& eventJsonUtf8, const char* sourceUtf8) {
    vf::JsonValue root;
    try {
        root = vf::parse_json(eventJsonUtf8);
    } catch (const std::exception& ex) {
        Log("Event program input parse failed: " + std::string(ex.what()));
        return false;
    }
    if (!root.is_object())
        return false;
    const auto& object = root.as_object();
    const std::string event = ObjectStringField(object, "event");
    const std::string frameId = ObjectStringField(object, "frame_id");
    const std::string widgetId = ObjectStringField(object, "widget_id");

    vf::JsonValue::Object statePatch;
    vf::JsonValue::Object displayFramesPatch;
    vf::JsonValue::Object displayGeomPatch;
    {
        std::lock_guard<std::mutex> lock(event_program_mutex_);
        std::string eventText;
        if (!frameId.empty() && !widgetId.empty() && EventDataValueAsString(object, "text", &eventText)) {
            event_values_[frameId + ":" + widgetId] = eventText;
        } else if (!frameId.empty() && !widgetId.empty() && EventDataValueAsString(object, "value", &eventText)) {
            event_values_[frameId + ":" + widgetId] = eventText;
        }
        for (const EventRule& rule : event_rules_) {
            if (rule.event != event)
                continue;
            if (!rule.frame_id.empty() && rule.frame_id != frameId)
                continue;
            if (!rule.widget_id.empty() && rule.widget_id != widgetId)
                continue;
            if (!rule.when_text.empty()) {
                const auto valueIt = event_values_.find(frameId + ":" + widgetId);
                if (valueIt == event_values_.end() || valueIt->second != rule.when_text)
                    continue;
            }
            vf::JsonValue::Object framePatch;
            for (const EventAction& action : rule.actions) {
                if (action.op == "increment" && !action.name.empty()) {
                    event_counters_[action.name] += 1;
                    continue;
                }
                if (action.op == "set_text" && !action.target.empty()) {
                    framePatch[action.target] = vf::JsonValue(vf::JsonValue::Object{
                        {"text", vf::JsonValue(ReplaceCounterVars(action.text, event_counters_))},
                    });
                    continue;
                }
                if (action.op == "set_widget_state") {
                    for (const auto& entry : action.state)
                        framePatch[entry.first] = entry.second;
                    continue;
                }
                if (action.op == "display_frame_ops" && !action.target.empty()) {
                    displayFramesPatch[action.target] = vf::JsonValue(action.ops);
                    continue;
                }
                if (action.op == "display_geom_empty" && !action.target.empty()) {
                    ++event_counters_[action.target + ".plot_request"];
                    plot_committed_meshes_.erase(action.target);
                    displayGeomPatch[action.target] = vf::JsonValue(vf::JsonValue::Object{
                        {"meshes", vf::JsonValue(vf::JsonValue::Array{})},
                        {"camera", vf::JsonValue(vf::JsonValue::Object{})},
                        {"lights", vf::JsonValue(vf::JsonValue::Array{})},
                    });
                    continue;
                }
                if (action.op == "plot_expr_to_frame_ops" && !action.target.empty()) {
                    const auto exprIt = event_values_.find(frameId + ":" + action.expr_widget);
                    const auto minIt = event_values_.find(frameId + ":" + action.min_widget);
                    const auto maxIt = event_values_.find(frameId + ":" + action.max_widget);
                    const auto countIt = event_values_.find(frameId + ":" + action.count_widget);
                    const auto yMinIt = event_values_.find(frameId + ":" + action.y_min_widget);
                    const auto yMaxIt = event_values_.find(frameId + ":" + action.y_max_widget);
                    const auto yCountIt = event_values_.find(frameId + ":" + action.y_count_widget);
                    const auto tMinIt = event_values_.find(frameId + ":" + action.t_min_widget);
                    const auto tMaxIt = event_values_.find(frameId + ":" + action.t_max_widget);
                    const auto tCountIt = event_values_.find(frameId + ":" + action.t_count_widget);
                    const auto tValueIt = event_values_.find(frameId + ":" + action.t_value_widget);
                    const auto faceIt = event_values_.find(frameId + ":" + action.face_widget);
                    const auto edgeIt = event_values_.find(frameId + ":" + action.edge_widget);
                    const auto vertexIt = event_values_.find(frameId + ":" + action.vertex_widget);
                    const auto edgeScaleIt = event_values_.find(frameId + ":" + action.edge_scale_widget);
                    const auto vertexScaleIt = event_values_.find(frameId + ":" + action.vertex_scale_widget);
                    const auto faceColormapIt = event_values_.find(frameId + ":" + action.face_colormap_widget);
                    const auto edgeColormapIt = event_values_.find(frameId + ":" + action.edge_colormap_widget);
                    const auto vertexColormapIt = event_values_.find(frameId + ":" + action.vertex_colormap_widget);
                    const std::string expr = exprIt == event_values_.end() || exprIt->second.empty() ? action.text : exprIt->second;
                    const double minValue =
                        minIt == event_values_.end() ? action.min_value : ParseExpressionNumberOr(minIt->second, action.min_value);
                    const double maxValue =
                        maxIt == event_values_.end() ? action.max_value : ParseExpressionNumberOr(maxIt->second, action.max_value);
                    const int countValue =
                        countIt == event_values_.end() ? action.count_value : ParseExpressionIntOr(countIt->second, action.count_value);
                    const double yMinValue =
                        yMinIt == event_values_.end() ? action.y_min_value : ParseExpressionNumberOr(yMinIt->second, action.y_min_value);
                    const double yMaxValue =
                        yMaxIt == event_values_.end() ? action.y_max_value : ParseExpressionNumberOr(yMaxIt->second, action.y_max_value);
                    const int yCountValue =
                        yCountIt == event_values_.end() ? action.y_count_value : ParseExpressionIntOr(yCountIt->second, action.y_count_value);
                    const double tMinValue =
                        tMinIt == event_values_.end() ? action.t_min_value : ParseExpressionNumberOr(tMinIt->second, action.t_min_value);
                    const double tMaxValue =
                        tMaxIt == event_values_.end() ? action.t_max_value : ParseExpressionNumberOr(tMaxIt->second, action.t_max_value);
                    const int tCountValue =
                        tCountIt == event_values_.end() ? action.t_count_value : ParseExpressionIntOr(tCountIt->second, action.t_count_value);
                    const double tValue =
                        tValueIt == event_values_.end() ? tMinValue : ParseExpressionNumberOr(tValueIt->second, tMinValue);
                    const std::string faceMode = faceIt == event_values_.end() ? action.face_mode : faceIt->second;
                    const std::string edgeMode = edgeIt == event_values_.end() ? action.edge_mode : edgeIt->second;
                    const std::string vertexMode = vertexIt == event_values_.end() ? action.vertex_mode : vertexIt->second;
                    const double edgeScale =
                        edgeScaleIt == event_values_.end() ? 1.0 : ParseExpressionNumberOr(edgeScaleIt->second, 1.0);
                    const double vertexScale =
                        vertexScaleIt == event_values_.end() ? 1.0 : ParseExpressionNumberOr(vertexScaleIt->second, 1.0);
                    const std::string faceColormap =
                        faceColormapIt == event_values_.end() ? action.face_colormap : faceColormapIt->second;
                    const std::string edgeColormap =
                        edgeColormapIt == event_values_.end() ? action.edge_colormap : edgeColormapIt->second;
                    const std::string vertexColormap =
                        vertexColormapIt == event_values_.end() ? action.vertex_colormap : vertexColormapIt->second;
                    const long long requestId = ++event_counters_[action.target + ".plot_request"];
                    framePatch["status_line"] = vf::JsonValue(vf::JsonValue::Object{
                        {"text", vf::JsonValue(std::string(action.commit_plot ? "adding: " : "plotting: ") + expr)},
                    });
                    SchedulePlotBuild(action, frameId, expr, minValue, maxValue, countValue, yMinValue, yMaxValue,
                                      yCountValue, tMinValue, tMaxValue, tCountValue, tValue,
                                      faceMode, edgeMode, vertexMode, edgeScale, vertexScale,
                                      faceColormap, edgeColormap, vertexColormap, requestId,
                                      sourceUtf8 ? sourceUtf8 : "native-event-program");
                    continue;
                }
            }
            if (!framePatch.empty())
                statePatch[frameId] = vf::JsonValue(framePatch);
        }
    }
    if (statePatch.empty() && displayFramesPatch.empty() && displayGeomPatch.empty())
        return false;

    std::string error;
    if (!statePatch.empty()) {
        vf::UiRuntimePacket packet;
        packet.kind = vf::UiRuntimePacketKind::UiStateReplace;
        packet.payload = vf::UiStateReplacePacketPayload{statePatch};
        if (!AppendRuntimePacket(std::move(packet), sourceUtf8 ? sourceUtf8 : "native-event-program", &error)) {
            if (!error.empty())
                Log("Event program output append failed: " + error);
            return false;
        }
    }
    if (!displayFramesPatch.empty() || !displayGeomPatch.empty()) {
        vf::UiRuntimePacket packet;
        packet.kind = vf::UiRuntimePacketKind::DisplayReplace;
        packet.payload = vf::DisplayReplacePacketPayload{vf::JsonValue::Object{
            {"screen", vf::JsonValue(vf::JsonValue::Array{})},
            {"frames", vf::JsonValue(displayFramesPatch)},
            {"geom", vf::JsonValue(displayGeomPatch)},
        }};
        if (!AppendRuntimePacket(std::move(packet), sourceUtf8 ? sourceUtf8 : "native-event-program", &error)) {
            if (!error.empty())
                Log("Event program display output append failed: " + error);
            return false;
        }
    }
    return true;
}

bool OverlayPacketRuntime::AppendRuntimePacketsJson(const std::string& jsonUtf8, const char* sourceUtf8,
                                                    std::string* errorOut) {
    if (errorOut)
        errorOut->clear();

    std::string packetsJson;
    std::string normalizeError;
    int packetCount = 0;
    if (!NormalizeRuntimePacketContractJson(jsonUtf8, &packetsJson, &packetCount, &normalizeError)) {
        if (errorOut)
            *errorOut = normalizeError;
        return false;
    }

    try {
        std::vector<vf::UiRuntimePacket> appended = ParseRuntimePackets(packetsJson);
        SnapshotState& state = MutableState(Channel::Runtime);
        std::lock_guard<std::mutex> lock(state.mutex);
        if (state.packets_cache.empty() && !state.packets_json_utf8.empty() && state.packets_json_utf8 != "[]")
            state.packets_cache = ParseRuntimePackets(state.packets_json_utf8);
        state.packets_cache.insert(state.packets_cache.end(), appended.begin(), appended.end());
        CapRuntimePacketHistory(state.packets_cache);
        state.packets_json_utf8 = vf::SerializeUiRuntimePackets(state.packets_cache, -1);
        state.packet_count = static_cast<int>(state.packets_cache.size());
        state.source_utf8 = sourceUtf8 ? sourceUtf8 : "unknown";
        state.auto_refresh_from_file = false;
        state.error_utf8.clear();
        ++state.revision;
        return true;
    } catch (const std::exception& ex) {
        if (errorOut)
            *errorOut = ex.what();
        return false;
    }
}

void OverlayPacketRuntime::SetInputRuntimePacketError(const char* sourceUtf8, const std::string& errorUtf8) {
    SnapshotState& state = MutableState(Channel::Input);
    std::lock_guard<std::mutex> lock(state.mutex);
    state.source_utf8 = sourceUtf8 ? sourceUtf8 : "unknown";
    state.auto_refresh_from_file = false;
    state.error_utf8 = errorUtf8;
    ++state.revision;
}

bool OverlayPacketRuntime::AppendInputRuntimePacketFromEventJson(const std::string& eventJsonUtf8, const char* sourceUtf8,
                                                                 std::string* errorOut) {
    if (errorOut)
        errorOut->clear();
    try {
        const vf::JsonValue root = vf::parse_json(eventJsonUtf8);
        if (!root.is_object())
            throw std::runtime_error("input event must be a JSON object");

        vf::UiRuntimePacket packet;
        packet.kind = vf::UiRuntimePacketKind::InputEvent;
        packet.payload = vf::InputEventPacketPayload{root.as_object()};

        SnapshotState& state = MutableState(Channel::Input);
        std::lock_guard<std::mutex> lock(state.mutex);
        packet.seq = state.next_seq++;
        std::vector<vf::UiRuntimePacket> packets;
        if (!state.packets_json_utf8.empty() && state.packets_json_utf8 != "[]")
            packets = ParseRuntimePackets(state.packets_json_utf8);
        packets.push_back(packet);
        constexpr std::size_t kMaxInputRuntimePackets = 256;
        if (packets.size() > kMaxInputRuntimePackets) {
            packets.erase(packets.begin(), packets.end() - static_cast<std::ptrdiff_t>(kMaxInputRuntimePackets));
        }
        state.packets_json_utf8 = vf::SerializeUiRuntimePackets(packets, -1);
        state.packet_count = static_cast<int>(packets.size());
        state.source_utf8 = sourceUtf8 ? sourceUtf8 : "unknown";
        state.auto_refresh_from_file = false;
        state.error_utf8.clear();
        ++state.revision;
        return true;
    } catch (const std::exception& ex) {
        if (errorOut)
            *errorOut = ex.what();
        SetInputRuntimePacketError(sourceUtf8, ex.what());
        return false;
    }
}

bool OverlayPacketRuntime::CaptureInputRuntimePacketFromEventJson(const std::string& eventJsonUtf8,
                                                                  const char* sourceUtf8) {
    std::string error;
    if (AppendInputRuntimePacketFromEventJson(eventJsonUtf8, sourceUtf8, &error))
        return true;
    if (!error.empty())
        Log("Input runtime packet packaging failed: " + error);
    return false;
}

bool OverlayPacketRuntime::TryHandleInputEventWebMessageAndDispatch(const std::string& webMessageJsonUtf8) {
    InputEventSink inputEventSink;
    {
        std::lock_guard<std::mutex> lock(input_event_sink_mutex_);
        inputEventSink = input_event_sink_;
    }
    if (!inputEventSink)
        return false;
    return TryHandleInputEventWebMessageAndDispatch(webMessageJsonUtf8, inputEventSink);
}

bool OverlayPacketRuntime::TryHandleInputEventWebMessageAndDispatch(const std::string& webMessageJsonUtf8,
                                                                    const InputEventSink& inputEventSink) {
    return TryHandleInputEventWebMessageAndDispatch(webMessageJsonUtf8, kWebMessageInputSource, inputEventSink);
}

bool OverlayPacketRuntime::TryHandleInputEventWebMessage(const std::string& webMessageJsonUtf8, const char* sourceUtf8,
                                                         std::string* eventJsonUtf8Out) {
    if (eventJsonUtf8Out)
        eventJsonUtf8Out->clear();

    try {
        vf::JsonValue root;
        if (!TryParseWebMessageObject(webMessageJsonUtf8, &root))
            return false;

        const auto& object = root.as_object();
        const auto eventIt = object.find("event");
        if (eventIt == object.end() || !eventIt->second.is_string())
            return false;
        const auto typeIt = object.find("type");
        if (typeIt != object.end() && typeIt->second.is_string() && typeIt->second.as_string() != "vf_event")
            return false;

        const std::string eventJsonUtf8 = vf::json_stringify(root, -1);
        CaptureInputRuntimePacketFromEventJson(eventJsonUtf8, sourceUtf8);
        if (eventJsonUtf8Out)
            *eventJsonUtf8Out = eventJsonUtf8;
        return true;
    } catch (const std::exception& ex) {
        Log("Input webmessage decode failed: " + std::string(ex.what()));
        return false;
    }
}

bool OverlayPacketRuntime::TryHandleInputEventWebMessageAndDispatch(const std::string& webMessageJsonUtf8,
                                                                    const char* sourceUtf8,
                                                                    const InputEventSink& inputEventSink) {
    std::string eventJsonUtf8;
    if (!TryHandleInputEventWebMessage(webMessageJsonUtf8, sourceUtf8, &eventJsonUtf8))
        return false;
    if (!eventJsonUtf8.empty())
        ExecuteEventProgramForInputEvent(eventJsonUtf8, sourceUtf8);
    if (!eventJsonUtf8.empty() && inputEventSink)
        inputEventSink(eventJsonUtf8);
    return true;
}

std::string OverlayPacketRuntime::BuildSnapshotResponseJson(Channel channel) const {
    const SnapshotState& state = ReadOnlyState(channel);
    std::lock_guard<std::mutex> lock(state.mutex);
    return BuildUiRuntimePacketSnapshotResponseJson(state, channel == Channel::Runtime);
}

void OverlayPacketRuntime::Log(const std::string& message) const {
    std::lock_guard<std::mutex> lock(log_sink_mutex_);
    if (log_sink_)
        log_sink_(message);
}

bool OverlayPacketRuntime::TryHandleHttpRequest(const std::string& method, const std::string& path,
                                                const std::string& bodyUtf8, const std::wstring& webRootW,
                                                HttpResult* resultOut) {
    if (!resultOut)
        return false;

    if (method == "GET") {
        if (path == "/api/runtime-packets") {
            std::string refreshError;
            RefreshRuntimePacketFileSnapshotIfConfigured(&refreshError);
            resultOut->status = 200;
            resultOut->status_text = "OK";
            resultOut->response_json = BuildSnapshotResponseJson(Channel::Runtime);
            return true;
        }
        if (path == "/api/runtime-packets/input") {
            resultOut->status = 200;
            resultOut->status_text = "OK";
            resultOut->response_json = BuildSnapshotResponseJson(Channel::Input);
            return true;
        }
        return false;
    }

    if (method != "POST")
        return false;

    if (path == "/api/runtime-packets") {
        std::string packetsJson;
        std::string error;
        int packetCount = 0;
        if (!NormalizeRuntimePacketContractJson(bodyUtf8, &packetsJson, &packetCount, &error)) {
            resultOut->status = 400;
            resultOut->status_text = "Bad Request";
            resultOut->response_json = BuildErrorResponseJson(error);
            return true;
        }
        SetRuntimePacketSnapshot(packetsJson, packetCount, "direct", L"", "");
        Log("Runtime packets accepted via HTTP: count=" + std::to_string(packetCount));
        resultOut->status = 200;
        resultOut->status_text = "OK";
        resultOut->response_json = BuildSnapshotResponseJson(Channel::Runtime);
        return true;
    }

    if (path == "/api/runtime-packets/append") {
        std::string error;
        if (!AppendRuntimePacketsJson(bodyUtf8, "direct", &error)) {
            resultOut->status = 400;
            resultOut->status_text = "Bad Request";
            resultOut->response_json = BuildErrorResponseJson(error);
            return true;
        }
        resultOut->status = 200;
        resultOut->status_text = "OK";
        resultOut->response_json = BuildSnapshotResponseJson(Channel::Runtime);
        return true;
    }

    if (path == "/api/runtime-packets/reload") {
        std::wstring pathOverride;
        const std::wstring pathW =
            TryExtractRuntimePacketPathOverride(bodyUtf8, &pathOverride) ? pathOverride : RuntimePacketDefaultPath(webRootW);
        std::string error;
        if (!LoadRuntimePacketFileIntoSnapshot(pathW, &error)) {
            resultOut->status = 400;
            resultOut->status_text = "Bad Request";
            resultOut->response_json = BuildErrorResponseJson(error, &pathW);
            return true;
        }
        resultOut->status = 200;
        resultOut->status_text = "OK";
        resultOut->response_json = BuildSnapshotResponseJson(Channel::Runtime);
        return true;
    }

    return false;
}

bool OverlayPacketRuntime::TryHandleHttpRequestAndRespond(const std::string& method, const std::string& path,
                                                          const std::string& bodyUtf8, const std::wstring& webRootW,
                                                          const HttpResponseSink& responseSink) {
    if (!responseSink)
        return false;

    HttpResult result;
    if (!TryHandleHttpRequest(method, path, bodyUtf8, webRootW, &result))
        return false;

    responseSink(result);
    return true;
}

bool OverlayPacketRuntime::TryHandleSocketHttpRequest(const std::string& method, const std::string& path,
                                                      const std::string& bodyUtf8, const std::wstring& webRootW,
                                                      SOCKET socket, const SocketHttpResponseSink& responseSink) {
    if (!responseSink)
        return false;

    return TryHandleHttpRequestAndRespond(
        method, path, bodyUtf8, webRootW,
        [socket, &responseSink](const HttpResult& result) {
            responseSink(socket, result.status, result.status_text.c_str(), result.response_json);
        });
}

bool OverlayPacketRuntime::TryServeSocketHttpRequest(const std::string& method, const std::string& path,
                                                     const std::string& bodyUtf8, const std::wstring& webRootW, SOCKET socket) {
    SocketHttpResponseSink responseSink;
    {
        std::lock_guard<std::mutex> lock(socket_response_sink_mutex_);
        responseSink = socket_http_response_sink_;
    }
    if (!responseSink)
        return false;
    if (!TryHandleSocketHttpRequest(method, path, bodyUtf8, webRootW, socket, responseSink))
        return false;
    closesocket(socket);
    return true;
}
