# Five-species stone contact pile

Status: private deterministic stone-placement refinement. No public VKF syntax,
constructor, schema, semantic, or performance claim changes.

## Gap closed

The previous 20-stone proof had five coherent geology profiles and four unique
individuals per profile, but its layer heights were authored constants. This
packet preserves every conditioned shape and material realization while replacing
those heights with deterministic downward settlement against bounded ellipsoidal
contact proxies derived from each realized mesh. Horizontal candidate locations
remain conditioned and bounded; gravity chooses plane or prior-stone support.

This is static deterministic contact settlement, not a claim of a dynamic rigid
body simulation or exact triangle-triangle collision. The private inner proxies
provide stable support ordering and a conservative no-persistent-penetration
contract for the placement state. The rendered positions are that same state.

## RED to GREEN

RED failed because elevated stones exposed no contact truth and the pile exposed
no penetration/floating result. GREEN proves:

- exactly 20 stones and exactly four members of each of five species;
- 20 unique conditioned identities and geometry hashes;
- six plane-grounded stones and 14 contact-supported elevated stones;
- every elevated stone contacts an earlier settled support;
- maximum normalized proxy penetration `1.1102230246251565e-16`;
- floating count `0` and deterministic replay exact;
- closed, nonplanar meshes remain 2,594 vertices / 5,184 triangles each;
- all five species retain coherent color/roughness ranges, full-surface R8 fine
  relief, zero extra microrelief triangles, and directional shadow reversal;
- total retained geometry remains below the existing 5 MiB bound.

Full relevant rock/stone/granite result: **55/55 GREEN** across 14 test files.
`git diff --check` is GREEN.

## Real WebGPU capture

`079-stone-species-contact-pile-webgpu.png` is a 2017x865 Chrome unified-WebGPU
frame. Self-inspection found the compact supported pile silhouette, all five
material families, irregular rounded bodies, non-flat undersides, and granular
surface response readable. No canvas/image fallback is involved; application
exception state was empty.

- SHA-256: `4F84AB414C459E3197D44FED0A792C6C2C075E5354010D03B14021ABCAA18180`

## Files

- `web/vf-ui/vf-stone-species-pile.mjs`
- `tests/js/vf-stone-species-pile.test.mjs`
- `tests/fixtures/stone-species-pile-hero.html`
- `docs/evidence/079-stone-species-contact-pile-webgpu.png`
