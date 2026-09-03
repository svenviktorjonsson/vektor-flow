#pragma once

#include "native/material/vf_material_reference_fit.hpp"

#include <array>
#include <string_view>

namespace vf::material {

inline constexpr std::array<MaterialReferenceSubset, 4>
kMaterialReferenceSubsetsV1{{
    {
        "usgs-splib07-stone-limestone-visible-v1",
        "https://landsat.usgs.gov/landsat/spectral_viewer/c3-master/"
        "htdocs/data/spectra/SoilsMixturesLimestone.json",
        "8C55B82A8E077210481E8DE71229BC7FEA1D5B58B300F2719F3294161FFD8FD3",
        {{
            {{{440, 0.154}, {445, 0.156}, {450, 0.158},
              {455, 0.159}, {460, 0.161}}},
            {{{540, 0.187}, {545, 0.189}, {550, 0.191},
              {555, 0.193}, {560, 0.194}}},
            {{{640, 0.212}, {645, 0.213}, {650, 0.214},
              {655, 0.214}, {660, 0.215}}},
        }},
    },
    {
        "usgs-splib07-road-asphalt-visible-v1",
        "https://landsat.usgs.gov/landsat/spectral_viewer/c3-master/"
        "htdocs/data/spectra/ArtificialMaterialsAsphalt.json",
        "BF00DA8297A6A3A8E09A27FA0A5FA1A976D3922C221DC34B565640D620EF4B93",
        {{
            {{{440, 0.067128398}, {445, 0.068095729},
              {450, 0.068933077}, {455, 0.069650806},
              {460, 0.070236713}}},
            {{{540, 0.08335042}, {545, 0.084449165},
              {550, 0.08558172}, {555, 0.086700849},
              {560, 0.087892458}}},
            {{{640, 0.10140797}, {645, 0.10202605},
              {650, 0.10264271}, {655, 0.10326861},
              {660, 0.10390794}}},
        }},
    },
    {
        "usgs-splib07-wood-cedar-shake-visible-v1",
        "https://landsat.usgs.gov/landsat/spectral_viewer/c3-master/"
        "htdocs/data/spectra/ArtificialMaterialsCedarShake.json",
        "AA62720B9D820F7F374075F91C331356131F496AE2365B7054158C9EDBA9E08D",
        {{
            {{{440, 0.063489199}, {445, 0.064808674},
              {450, 0.066044942}, {455, 0.067217998},
              {460, 0.068326905}}},
            {{{540, 0.087914012}, {545, 0.089156218},
              {550, 0.090367377}, {555, 0.091539592},
              {560, 0.092642166}}},
            {{{640, 0.10343436}, {645, 0.10371097},
              {650, 0.10396254}, {655, 0.10435417},
              {660, 0.104678}}},
        }},
    },
    {
        "usgs-splib07-leaf-aspen-a-visible-v1",
        "https://landsat.usgs.gov/landsat/spectral_viewer/c3-master/"
        "htdocs/data/spectra/VegetationAspenLeafA.json",
        "BC738232B68CEDDCEA305A10CCDA2D91684C8E621065EBD857C412FAF2CBD92D",
        {{
            {{{446, 0.0366}, {449, 0.0374}, {451, 0.0375},
              {453, 0.0378}, {455, 0.0376}}},
            {{{547, 0.0861}, {549, 0.0870}, {551, 0.0872},
              {553, 0.0873}, {555, 0.0874}}},
            {{{646, 0.0406}, {648, 0.0404}, {650, 0.0405},
              {652, 0.0390}, {654, 0.0397}}},
        }},
    },
}};

}  // namespace vf::material
