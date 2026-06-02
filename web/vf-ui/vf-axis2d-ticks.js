(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.VfAxis2DTicks = factory();
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function tickDistanceBand(tickDist, minTickDist, maxTickDist) {
    var target = Math.max(1, Number(tickDist) || 72);
    var lo = Number(minTickDist);
    var hi = Number(maxTickDist);
    if (!(lo > 0)) { lo = target * 0.72; }
    if (!(hi > lo)) { hi = target * 1.45; }
    return { target: target, min: lo, max: hi };
  }

  function tickSpacingScore(px, band) {
    var spacing = Math.max(1e-9, Number(px) || 0);
    if (spacing >= band.min && spacing <= band.max) {
      var center = Math.sqrt(band.min * band.max);
      return Math.abs(Math.log(spacing / center)) * 0.01;
    }
    if (spacing < band.min) {
      return Math.log(band.min / spacing);
    }
    return Math.log(spacing / band.max);
  }

  function chooseAxisTickStep(dataPerPixel, tickDist, hints, minTickDist, maxTickDist) {
    var band = tickDistanceBand(tickDist, minTickDist, maxTickDist);
    var target = Math.max(1e-12, Math.abs(Number(dataPerPixel) || 0) * Math.max(1, Number(tickDist) || 72));
    var rawHints = Array.isArray(hints) && hints.length ? hints : [1, 2, 5];
    var cleanHints = [];
    for (var hi = 0; hi < rawHints.length; hi += 1) {
      var hv = Math.abs(Number(rawHints[hi]) || 0);
      if (hv > 0) { cleanHints.push(hv); }
    }
    if (!cleanHints.length) { cleanHints = [1, 2, 5]; }
    var pow = Math.floor(Math.log(target) / Math.LN10);
    var best = cleanHints[0] * Math.pow(10, pow);
    var bestScore = Infinity;
    for (var pi = pow - 1; pi <= pow + 1; pi += 1) {
      var scale = Math.pow(10, pi);
      for (var ci = 0; ci < cleanHints.length; ci += 1) {
        var cand = cleanHints[ci] * scale;
        var spacingPx = cand / Math.max(1e-12, Math.abs(Number(dataPerPixel) || 0));
        var score = tickSpacingScore(spacingPx, band);
        if (score < bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    return best;
  }

  function stripMathLabelText(label) {
    return String(label || "")
      .replace(/\$/g, "")
      .replace(/\\cdot/g, "*")
      .replace(/\{|\}/g, "");
  }

  function estimateTickLabelWidthPx(label, fontSize) {
    var text = stripMathLabelText(label);
    return Math.max(1, text.length) * Math.max(1, Number(fontSize) || 11) * 0.58 + 8;
  }

  function maxEstimatedTickLabelWidthPx(values, mode, minValue, maxValue, offset, step, fontSize) {
    var maxW = 0;
    for (var i = 0; i < values.length; i += 1) {
      var label = axisTickLabelWithOffset(values[i], mode, minValue, maxValue, offset, step);
      maxW = Math.max(maxW, estimateTickLabelWidthPx(label, fontSize));
    }
    return maxW;
  }

  function chooseReadableLinearTickStep(minValue, maxValue, step, explicitValues, mode, hints, pixelSpan, tickDist, minTickDist, maxTickDist, fontSize) {
    var current = Math.max(1e-12, Math.abs(Number(step) || 0));
    var span = Math.max(1, Number(pixelSpan) || 1);
    var dataPerPixel = (Number(maxValue) - Number(minValue)) / span;
    var explicit = explicitAxisTicks(explicitValues);
    if (explicit || !(dataPerPixel > 0)) { return current; }
    var rawHints = Array.isArray(hints) && hints.length ? hints : [1, 2, 5];
    var safeMinDist = Math.max(1, Number(minTickDist) || 0);
    for (var tries = 0; tries < 12; tries += 1) {
      var vals = axisTickValuesForMode(minValue, maxValue, current, null, mode, false, hints, span, tickDist, minTickDist, maxTickDist);
      if (vals.length < 2) { return current; }
      var off = axisLabelOffset(vals, minValue, maxValue);
      var labelMinDist = maxEstimatedTickLabelWidthPx(vals, mode, minValue, maxValue, off, current, fontSize) + 8;
      var spacingPx = current / Math.max(1e-12, Math.abs(dataPerPixel));
      if (spacingPx >= Math.max(safeMinDist, labelMinDist)) { return current; }
      current = chooseAxisTickStep(dataPerPixel, Math.max(Number(tickDist) || 72, labelMinDist), rawHints, Math.max(safeMinDist, labelMinDist), maxTickDist);
      if (!(current > 0)) { return step; }
      dataPerPixel = (Number(maxValue) - Number(minValue)) / span;
    }
    return current;
  }

  function firstAxisTick(minValue, step) {
    return Math.ceil((minValue - (step * 1e-9)) / step) * step;
  }

  function explicitAxisTicks(values) {
    if (!Array.isArray(values)) { return null; }
    var out = [];
    for (var i = 0; i < values.length; i += 1) {
      var v = Number(values[i]);
      if (Number.isFinite(v)) { out.push(v); }
    }
    return out;
  }

  function axisTickValues(minValue, maxValue, step, explicitValues) {
    var out = [];
    var explicit = explicitAxisTicks(explicitValues);
    var maxTicks = 1000;
    if (explicit) {
      for (var i = 0; i < explicit.length && out.length < maxTicks; i += 1) {
        var ev = explicit[i];
        if (ev >= minValue - step * 1e-9 && ev <= maxValue + step * 1e-9 && Math.abs(ev) >= step * 1e-10) {
          out.push(ev);
        }
      }
      return out;
    }
    for (var v = firstAxisTick(minValue, step); v <= maxValue + step * 1e-9 && out.length < maxTicks; v += step) {
      out.push(Math.abs(v) < step * 1e-10 ? 0 : v);
    }
    return out;
  }

  function axisTickValuesNoZero(minValue, maxValue, step, explicitValues) {
    var raw = axisTickValues(minValue, maxValue, step, explicitValues);
    var out = [];
    for (var i = 0; i < raw.length; i += 1) {
      if (Math.abs(raw[i]) >= step * 1e-10) { out.push(raw[i]); }
    }
    return out;
  }

  function decimalPlacesForStep(step) {
    var s = Math.abs(Number(step) || 0);
    if (!Number.isFinite(s) || s <= 0) { return null; }
    var text = String(Number(s.toPrecision(12)));
    var exp = text.match(/e([+-]?\d+)$/i);
    if (exp) {
      return Math.max(0, -Number(exp[1]));
    }
    var dot = text.indexOf(".");
    return dot >= 0 ? Math.min(12, text.length - dot - 1) : 0;
  }

  function snapTickValueForLabel(value, step) {
    var v = Number(value) || 0;
    var s = Math.abs(Number(step) || 0);
    if (!Number.isFinite(s) || s <= 0) { return v; }
    return Math.round(v / s) * s;
  }

  function formatScientificBody(value) {
    var v = Number(value) || 0;
    if (v === 0) { return "0"; }
    var sign = v < 0 ? "-" : "";
    var av = Math.abs(v);
    if (av >= 0.01 && av < 1e4) {
      return sign + String(Number(av.toPrecision(6)));
    }
    var exponent = Math.floor(Math.log(av) / Math.LN10);
    var mantissa = Number((av / Math.pow(10, exponent)).toPrecision(6));
    if (Math.abs(mantissa - 10) < 1e-8) {
      mantissa = 1;
      exponent += 1;
    }
    if (Math.abs(mantissa - 1) < 1e-8) {
      return sign + "10^{" + String(exponent) + "}";
    }
    return sign + String(mantissa) + " \\cdot 10^{" + String(exponent) + "}";
  }

  function formatAxisTickLabel(value, step) {
    var v = Number(value) || 0;
    var decimals = decimalPlacesForStep(step);
    if (decimals !== null) {
      v = snapTickValueForLabel(v, step);
    }
    if (Math.abs(v) < 1e-12) { v = 0; }
    var av = Math.abs(v);
    if (av !== 0 && (av < 0.01 || av >= 1e4)) {
      return "$" + formatScientificBody(v) + "$";
    }
    if (decimals !== null) {
      if (decimals === 0 || Math.abs(v - Math.round(v)) < 1e-12) {
        return "$" + String(Math.round(v)) + "$";
      }
      return "$" + Number(v.toFixed(decimals)).toFixed(decimals).replace(/\.?0+$/, "") + "$";
    }
    if (Math.abs(v - Math.round(v)) < 1e-12) { return "$" + String(Math.round(v)) + "$"; }
    return "$" + String(Number(v.toPrecision(6))) + "$";
  }

  function formatOffsetLabel(offset) {
    var v = Number(offset) || 0;
    if (v === 0) { return ""; }
    return "$" + (v > 0 ? "+ " : "- ") + formatScientificBody(Math.abs(v)) + "$";
  }

  function axisLabelOffset(values, minValue, maxValue) {
    if (!Array.isArray(values) || values.length < 2) { return 0; }
    var lo = Number(minValue);
    var hi = Number(maxValue);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) { return 0; }
    var minDelta = Infinity;
    for (var i = 1; i < values.length; i += 1) {
      var d = Math.abs(Number(values[i]) - Number(values[i - 1]));
      if (d > 0 && d < minDelta) { minDelta = d; }
    }
    if (!Number.isFinite(minDelta) || minDelta <= 0) { return 0; }
    var center = (lo + hi) * 0.5;
    if (Math.abs(center) / minDelta < 1e5) { return 0; }
    var offset = Math.floor(lo / minDelta) * minDelta;
    if (!Number.isFinite(offset) || offset === 0) { return 0; }
    return offset;
  }

  function formatLogAxisTickLabel(value, minValue, maxValue) {
    var v = Number(value) || 0;
    if (v === 0) { return ""; }
    var lo = Math.abs(Number(minValue) || 0);
    var hi = Math.abs(Number(maxValue) || 0);
    var rangeRatio = lo > 0 && hi > lo ? hi / lo : Infinity;
    if (rangeRatio < 10) {
      return formatAxisTickLabel(value);
    }
    var av = Math.abs(v);
    if (av >= 0.01 && av < 1e4) {
      return "$" + (v < 0 ? "-" : "") + String(Number(av.toPrecision(6))) + "$";
    }
    return "$" + formatScientificBody(v) + "$";
  }

  function isSubDecadePositiveRange(minValue, maxValue) {
    var lo = Number(minValue);
    var hi = Number(maxValue);
    return lo > 0 && hi > lo && hi / lo < 10;
  }

  function isLogTickMode(mode) {
    return String(mode || "linear").toLowerCase() === "log";
  }

  function axisTickLabelForMode(value, mode, minValue, maxValue) {
    return isLogTickMode(mode) ? formatLogAxisTickLabel(value, minValue, maxValue) : formatAxisTickLabel(value);
  }

  function axisTickLabelWithOffset(value, mode, minValue, maxValue, offset, step) {
    var off = Number(offset) || 0;
    if (off !== 0) {
      var delta = Number(value) - off;
      if (Math.abs(delta) < Math.abs(Number(value) || 0) * 1e-12) { delta = 0; }
      return formatAxisTickLabel(delta, step);
    }
    if (!isLogTickMode(mode) || isSubDecadePositiveRange(minValue, maxValue)) {
      return formatAxisTickLabel(value, step);
    }
    return axisTickLabelForMode(value, mode, minValue, maxValue);
  }

  function positiveLogTickValues(minValue, maxValue, explicitValues, hints) {
    var explicit = explicitAxisTicks(explicitValues);
    if (explicit) {
      var filtered = [];
      for (var ei = 0; ei < explicit.length; ei += 1) {
        if (explicit[ei] > 0 && explicit[ei] >= minValue * (1 - 1e-6) && explicit[ei] <= maxValue * (1 + 1e-6)) {
          filtered.push(explicit[ei]);
        }
      }
      return filtered;
    }
    var minV = Math.max(Number.MIN_VALUE, Number(minValue) || 0);
    var maxV = Number(maxValue) || 0;
    if (!(maxV > minV) || minV <= 0) { return []; }
    var pixelSpan = Math.max(1, Number(arguments[4]) || 1);
    var targetPx = Math.max(1, Number(arguments[5]) || 72);
    var band = tickDistanceBand(targetPx, arguments[6], arguments[7]);
    var rawHints = Array.isArray(hints) && hints.length ? hints : [1, 2, 5];
    var cleanHints = [];
    for (var hi = 0; hi < rawHints.length; hi += 1) {
      var hv = Math.abs(Number(rawHints[hi]) || 0);
      if (hv > 0 && hv <= 5) { cleanHints.push(hv); }
    }
    if (!cleanHints.length) { cleanHints = [1, 2, 5]; }
    cleanHints.sort(function (a, b) { return a - b; });
    function mantissasForHint(hint) {
      var jump = Math.max(1.0, Number(hint) || 1.0);
      var values = [1.0];
      var cur = 1.0;
      if (jump > 1.0 && jump < 10.0) {
        cur = jump;
        if (cur <= 5.0) { values.push(cur); }
      }
      while (true) {
        var next = cur + jump;
        if (!(next < 10.0)) { break; }
        if ((10.0 - next) < jump - 1e-9) { break; }
        if (next <= 5.0) { values.push(next); }
        cur = next;
      }
      return values;
    }
    var patternCandidates = [];
    for (var hix = 0; hix < cleanHints.length; hix += 1) {
      var h = cleanHints[hix];
      patternCandidates.push({ hint: h, mantissas: mantissasForHint(h) });
    }
    if (!patternCandidates.length) {
      patternCandidates = [{ hint: 5, mantissas: [1, 5] }];
    }
    var bestPattern = patternCandidates[patternCandidates.length - 1];
    var bestScore = Infinity;

    function ticksForPattern(pattern) {
      var values = [];
      var seen = Object.create(null);
      function addTick(v) {
        if (!(v > 0) || v < minV * (1 - 1e-6) || v > maxV * (1 + 1e-6)) { return; }
        var key = String(Number(v.toPrecision(12)));
        if (seen[key]) { return; }
        seen[key] = true;
        values.push(v);
      }
      var e0 = Math.floor(Math.log(minV) / Math.LN10) - 1;
      var e1 = Math.ceil(Math.log(maxV) / Math.LN10) + 1;
      var decadeStep = Math.max(1, Number(pattern.decadeStep) || 1);
      var firstE = Math.ceil((e0 - decadeStep * 1e-9) / decadeStep) * decadeStep;
      for (var e = firstE; e <= e1 && values.length < 10000; e += decadeStep) {
        var scale = Math.pow(10, e);
        addTick(scale);
        if (decadeStep === 1) {
          for (var mi = 0; mi < pattern.mantissas.length && values.length < 10000; mi += 1) {
            addTick(pattern.mantissas[mi] * scale);
          }
        }
      }
      values.sort(function (a, b) { return a - b; });
      return values;
    }

    function avgPatternPixelDistance(pattern) {
      var values = [];
      var decadeStep = Math.max(1, Number(pattern.decadeStep) || 1);
      for (var e = 0; e <= 24 && values.length < 1000; e += decadeStep) {
        var scale = Math.pow(10, e);
        values.push(scale);
        if (decadeStep === 1) {
          for (var mi = 0; mi < pattern.mantissas.length; mi += 1) {
            values.push(pattern.mantissas[mi] * scale);
          }
        }
      }
      values.sort(function (a, b) { return a - b; });
      if (values.length < 2) { return Infinity; }
      var ratio = Math.max(1.000001, maxV / minV);
      var l0 = 0;
      var l1 = Math.log(ratio) / Math.LN10;
      var prev = (Math.log(values[0]) / Math.LN10 - l0) / Math.max(1e-12, l1 - l0) * pixelSpan;
      var total = 0;
      var count = 0;
      for (var i = 1; i < values.length; i += 1) {
        var cur = (Math.log(values[i]) / Math.LN10 - l0) / Math.max(1e-12, l1 - l0) * pixelSpan;
        total += Math.abs(cur - prev);
        count += 1;
        prev = cur;
      }
      return count ? total / count : Infinity;
    }

    var logRange = Math.max(0, Math.log(maxV / minV) / Math.LN10);
    var exponentSteps = [1];
    var stepSeen = { "1": true };
    var stepLimit = Math.max(1, Math.min(300, Math.ceil(logRange)));
    for (var dhi = 0; dhi < cleanHints.length; dhi += 1) {
      var baseStep = Math.max(1, Math.round(cleanHints[dhi]));
      var decadeScale = 1;
      var s = baseStep * decadeScale;
      while (s <= stepLimit) {
        var skey = String(s);
        if (!stepSeen[skey]) {
          stepSeen[skey] = true;
          exponentSteps.push(s);
        }
        if (decadeScale > stepLimit / 10) { break; }
        decadeScale *= 10;
        s = baseStep * decadeScale;
      }
    }
    exponentSteps.sort(function (a, b) { return a - b; });
    var expandedPatterns = [];
    for (var epi = 0; epi < exponentSteps.length; epi += 1) {
      for (var ppi = 0; ppi < patternCandidates.length; ppi += 1) {
        expandedPatterns.push({
          hint: patternCandidates[ppi].hint,
          mantissas: patternCandidates[ppi].mantissas,
          decadeStep: exponentSteps[epi]
        });
      }
    }
    for (var pi = 0; pi < expandedPatterns.length; pi += 1) {
      var candidate = ticksForPattern(expandedPatterns[pi]);
      if (!candidate.length) { continue; }
      var avgPx = avgPatternPixelDistance(expandedPatterns[pi]);
      var score = tickSpacingScore(avgPx, band);
      if (candidate.length === 1) {
        score += 3.0;
      }
      if (score < bestScore) {
        bestScore = score;
        bestPattern = expandedPatterns[pi];
      }
    }
    return ticksForPattern(bestPattern).slice(0, 1000);
  }

  function signedLogTickValues(minValue, maxValue, explicitValues, hints, pixelSpan, tickDist, minTickDist, maxTickDist) {
    var explicit = explicitAxisTicks(explicitValues);
    if (explicit) {
      var filtered = [];
      for (var ei = 0; ei < explicit.length; ei += 1) {
        if (explicit[ei] !== 0 && explicit[ei] >= minValue && explicit[ei] <= maxValue) {
          filtered.push(explicit[ei]);
        }
      }
      return filtered;
    }
    var out = [];
    var maxAbs = Math.max(Math.abs(Number(minValue) || 0), Math.abs(Number(maxValue) || 0));
    var crossingZeroMinAbs = maxAbs > 0 ? maxAbs / 1000 : 1;
    if (minValue < 0) {
      var negMinAbs = maxValue >= 0 ? crossingZeroMinAbs : Math.max(Number.MIN_VALUE, Math.abs(maxValue));
      var negMaxAbs = Math.abs(minValue);
      var neg = positiveLogTickValues(negMinAbs, negMaxAbs, null, hints, pixelSpan, tickDist, minTickDist, maxTickDist);
      for (var ni = neg.length - 1; ni >= 0; ni -= 1) {
        var nv = -neg[ni];
        if (nv >= minValue && nv <= maxValue) { out.push(nv); }
      }
    }
    if (maxValue > 0) {
      var posMin = minValue <= 0 ? crossingZeroMinAbs : Math.max(Number.MIN_VALUE, minValue);
      var pos = positiveLogTickValues(posMin, maxValue, null, hints, pixelSpan, tickDist, minTickDist, maxTickDist);
      for (var pi = 0; pi < pos.length; pi += 1) {
        if (pos[pi] >= minValue && pos[pi] <= maxValue) { out.push(pos[pi]); }
      }
    }
    return out;
  }

  function axisTickValuesForMode(minValue, maxValue, step, explicitValues, mode, signedLog, hints, pixelSpan, tickDist, minTickDist, maxTickDist) {
    if (isLogTickMode(mode)) {
      if (!signedLog && isSubDecadePositiveRange(minValue, maxValue)) {
        return axisTickValues(minValue, maxValue, step, explicitValues);
      }
      return signedLog
        ? signedLogTickValues(minValue, maxValue, explicitValues, hints, pixelSpan, tickDist, minTickDist, maxTickDist)
        : positiveLogTickValues(minValue, maxValue, explicitValues, hints, pixelSpan, tickDist, minTickDist, maxTickDist);
    }
    return axisTickValues(minValue, maxValue, step, explicitValues);
  }

  function axisTickValuesNoZeroForMode(minValue, maxValue, step, explicitValues, mode, signedLog, hints, pixelSpan, tickDist, minTickDist, maxTickDist) {
    if (isLogTickMode(mode)) {
      if (!signedLog && isSubDecadePositiveRange(minValue, maxValue)) {
        return axisTickValuesNoZero(minValue, maxValue, step, explicitValues);
      }
      return signedLog
        ? signedLogTickValues(minValue, maxValue, explicitValues, hints, pixelSpan, tickDist, minTickDist, maxTickDist)
        : positiveLogTickValues(minValue, maxValue, explicitValues, hints, pixelSpan, tickDist, minTickDist, maxTickDist);
    }
    return axisTickValuesNoZero(minValue, maxValue, step, explicitValues);
  }

  function axisCrosshairTickValuesForMode(minValue, maxValue, step, explicitValues, mode, hints, pixelSpan, tickDist, minTickDist, maxTickDist) {
    var values = axisTickValuesNoZeroForMode(minValue, maxValue, step, explicitValues, mode, false, hints, pixelSpan, tickDist, minTickDist, maxTickDist);
    if (!isLogTickMode(mode)) { return values; }
    return values.filter(function (v) {
      return Math.abs((Number(v) || 0) - 1) > 1e-12;
    });
  }

  function axisValueToUnit(value, minValue, maxValue, mode) {
    var v = Number(value);
    var lo = Number(minValue);
    var hi = Number(maxValue);
    if (isLogTickMode(mode) && v > 0 && lo > 0 && hi > lo) {
      var l0 = Math.log(lo) / Math.LN10;
      var l1 = Math.log(hi) / Math.LN10;
      return ((Math.log(v) / Math.LN10) - l0) / Math.max(1e-12, l1 - l0);
    }
    return (v - lo) / Math.max(1e-12, hi - lo);
  }

  function axisUnitToValue(unit, minValue, maxValue, mode) {
    var u = Number(unit);
    var lo = Number(minValue);
    var hi = Number(maxValue);
    if (isLogTickMode(mode) && lo > 0 && hi > lo) {
      var l0 = Math.log(lo) / Math.LN10;
      var l1 = Math.log(hi) / Math.LN10;
      return Math.pow(10, l0 + u * (l1 - l0));
    }
    return lo + u * (hi - lo);
  }

  function buildAxisBoxTickState(spec) {
    var cfg = spec || {};
    var width = Math.max(1, Number(cfg.width) || 1);
    var height = Math.max(1, Number(cfg.height) || 1);
    var xMin = Number(cfg.x_min);
    var xMax = Number(cfg.x_max);
    var yMin = Number(cfg.y_min);
    var yMax = Number(cfg.y_max);
    var out = {};
    if (xMax > xMin) {
      var xStep = chooseAxisTickStep((xMax - xMin) / width, cfg.dist, cfg.hints, cfg.min_dist, cfg.max_dist);
      xStep = chooseReadableLinearTickStep(xMin, xMax, xStep, cfg.x_ticks, cfg.x_mode, cfg.hints, width, cfg.dist, cfg.min_dist, cfg.max_dist, cfg.tick_label_font_size);
      var xValues = axisTickValuesForMode(xMin, xMax, xStep, cfg.x_ticks, cfg.x_mode, false, cfg.hints, width, cfg.dist, cfg.min_dist, cfg.max_dist);
      out.x = {
        step: xStep,
        values: xValues,
        offset: axisLabelOffset(xValues, xMin, xMax)
      };
    }
    if (yMax > yMin) {
      var yStep = chooseAxisTickStep((yMax - yMin) / height, cfg.dist, cfg.hints, cfg.min_dist, cfg.max_dist);
      var yValues = axisTickValuesForMode(yMin, yMax, yStep, cfg.y_ticks, cfg.y_mode, false, cfg.hints, height, cfg.dist, cfg.min_dist, cfg.max_dist);
      out.y = {
        step: yStep,
        values: yValues,
        offset: axisLabelOffset(yValues, yMin, yMax)
      };
    }
    return out;
  }

  function buildAxisCrosshairTickState(spec) {
    var cfg = spec || {};
    var width = Math.max(1, Number(cfg.width) || 1);
    var height = Math.max(1, Number(cfg.height) || 1);
    var xVisibleMin = Number(cfg.x_visible_min);
    var xVisibleMax = Number(cfg.x_visible_max);
    var yVisibleMin = Number(cfg.y_visible_min);
    var yVisibleMax = Number(cfg.y_visible_max);
    var out = {};
    if (xVisibleMax > xVisibleMin) {
      var xStep = chooseAxisTickStep((xVisibleMax - xVisibleMin) / width, cfg.dist, cfg.hints, cfg.min_dist, cfg.max_dist);
      xStep = chooseReadableLinearTickStep(xVisibleMin, xVisibleMax, xStep, cfg.x_ticks, cfg.x_mode, cfg.hints, width, cfg.dist, cfg.min_dist, cfg.max_dist, cfg.tick_label_font_size);
      var xValues = axisCrosshairTickValuesForMode(xVisibleMin, xVisibleMax, xStep, cfg.x_ticks, cfg.x_mode, cfg.hints, width, cfg.dist, cfg.min_dist, cfg.max_dist);
      out.x = { step: xStep, values: xValues, offset: axisLabelOffset(xValues, xVisibleMin, xVisibleMax), visible_min: xVisibleMin, visible_max: xVisibleMax };
    }
    if (yVisibleMax > yVisibleMin) {
      var yStep = chooseAxisTickStep((yVisibleMax - yVisibleMin) / height, cfg.dist, cfg.hints, cfg.min_dist, cfg.max_dist);
      var yValues = axisCrosshairTickValuesForMode(yVisibleMin, yVisibleMax, yStep, cfg.y_ticks, cfg.y_mode, cfg.hints, height, cfg.dist, cfg.min_dist, cfg.max_dist);
      out.y = { step: yStep, values: yValues, offset: axisLabelOffset(yValues, yVisibleMin, yVisibleMax), visible_min: yVisibleMin, visible_max: yVisibleMax };
    }
    return out;
  }

  return {
    tickDistanceBand: tickDistanceBand,
    tickSpacingScore: tickSpacingScore,
    chooseAxisTickStep: chooseAxisTickStep,
    chooseReadableLinearTickStep: chooseReadableLinearTickStep,
    axisTickValuesForMode: axisTickValuesForMode,
    axisCrosshairTickValuesForMode: axisCrosshairTickValuesForMode,
    axisTickLabelWithOffset: axisTickLabelWithOffset,
    axisTickLabelForMode: axisTickLabelForMode,
    axisLabelOffset: axisLabelOffset,
    axisValueToUnit: axisValueToUnit,
    axisUnitToValue: axisUnitToValue,
    buildAxisBoxTickState: buildAxisBoxTickState,
    buildAxisCrosshairTickState: buildAxisCrosshairTickState,
    isLogTickMode: isLogTickMode,
    formatAxisTickLabel: formatAxisTickLabel,
    formatOffsetLabel: formatOffsetLabel,
  };
}));
