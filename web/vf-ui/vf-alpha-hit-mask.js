(function (global) {
  "use strict";

  function fromImageData(imageData, options) {
    options = options || {};
    var width = Math.max(0, Math.trunc(Number(imageData && imageData.width) || 0));
    var height = Math.max(0, Math.trunc(Number(imageData && imageData.height) || 0));
    var data = imageData && imageData.data;
    var threshold = Math.max(0, Math.min(255, Math.trunc(Number(options.alphaThreshold) || 0)));
    var regions = [];
    if (!data || width === 0 || height === 0) { return regions; }

    for (var y = 0; y < height; y += 1) {
      var runStart = -1;
      for (var x = 0; x <= width; x += 1) {
        var opaque = x < width && Number(data[((y * width + x) * 4) + 3] || 0) > threshold;
        if (opaque && runStart < 0) {
          runStart = x;
        } else if (!opaque && runStart >= 0) {
          regions.push({ left: runStart, top: y, right: x, bottom: y + 1 });
          runStart = -1;
        }
      }
    }
    return regions;
  }

  function rasterizeSvg(svg, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      if (!svg || typeof svg.getBoundingClientRect !== "function") {
        reject(new Error("rasterizeSvg requires an SVG element"));
        return;
      }
      var bounds = svg.getBoundingClientRect();
      var width = Math.max(1, Math.ceil(Number(bounds.width) || 0));
      var height = Math.max(1, Math.ceil(Number(bounds.height) || 0));
      var serializer = new XMLSerializer();
      var text = serializer.serializeToString(svg);
      var blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var image = new Image();
      image.onload = function () {
        try {
          var canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          var context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) { throw new Error("2D canvas is unavailable"); }
          context.clearRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          var pixels = context.getImageData(0, 0, width, height);
          resolve({
            width: width,
            height: height,
            regions: fromImageData(pixels, options)
          });
        } catch (error) {
          reject(error);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("SVG alpha-mask rasterization failed"));
      };
      image.src = url;
    });
  }

  function translate(regions, left, top) {
    var dx = Number(left) || 0;
    var dy = Number(top) || 0;
    return (Array.isArray(regions) ? regions : []).map(function (region) {
      return {
        left: dx + Number(region.left || 0),
        top: dy + Number(region.top || 0),
        right: dx + Number(region.right || 0),
        bottom: dy + Number(region.bottom || 0)
      };
    });
  }

  global.VfAlphaHitMask = {
    fromImageData: fromImageData,
    rasterizeSvg: rasterizeSvg,
    translate: translate
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
