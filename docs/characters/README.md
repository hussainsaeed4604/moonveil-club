# /workspace/forge: Moonveil Club character pipeline

## Deliverables (`out/`)

| File | Use | Decoder needed |
| --- | --- | --- |
| `female_hq.glb`, `male_hq.glb` | Desktop web and installed builds (primary) | none (KHR_mesh_quantization and EXT_texture_webp are both handled by three r160 GLTFLoader) |
| `female_lite.glb`, `male_lite.glb` | iPhone test builds | none |
| `*_meshopt.glb` | Same content, about 40% smaller | `loader.setMeshoptDecoder(MeshoptDecoder)` from `three/addons/libs/meshopt_decoder.module.js` |

Same bones (`J_Bip_*` humanoid + `J_Adj_*` + `J_Sec_*`), material names, mesh names and clips in every file. Facing follows the VRoid/VRM0 convention, so the existing `model.rotation.y = Math.PI` in `adornFigure` stays.

## Mesh / material contract

Meshes: `Body`, `Face` (morphs `fun` (default 0.3 = soft smile), `joy`, `blink`, `aa`), `Hair_Base`, `Hair_Long`, `Hair_Topknot`, `Hair_Bun`, `Acc_Hairpiece` (female only), `Robe`, `Robe_Trim`, `Robe_Pattern`, `Robe_Sheer`, `Sleeves`, `Sleeves_Sheer`, `Jewelry`.

Materials (tint with `material.color`):
`SKIN`, `SKIN_FACE` (skin tone, same hex for both) · `FACE` (eyes/brows/mouth atlas, alpha-blended, emissive so it never goes dark; do not tint) · `HAIR` · `ROBE` (textured, about 0.85 luminance) · `ROBE_INNER` (cross-collar underlayer) · `ROBE_SHEER` (alpha 0.30) · `ACCENT` (gold trims, jewelry, cord caps) · `ACCENT_PATTERN` (gold floral/cloud overlay on the skirt; tint with the accent hex).

## Integration notes for the coding agent (when cleared)

1. `hideCloth` hides any material matching `/CLOTH|...|HAIR/i`, which would now hide our `HAIR`. Narrow that regex, or skip `hideCloth` for these files.
2. When converting to `MeshToonMaterial`, copy `map, color, emissive, emissiveMap, emissiveIntensity, transparent, opacity, alphaTest, side, depthWrite`. Dropping `opacity`, `transparent` or `emissiveMap` makes the face/eyes dark or blank and the sheer opaque.
3. Make `SKIN` follow the tint and never go black: `m.emissive.copy(m.color).multiplyScalar(0.12)` after `tintSkin`.
4. Replace `addRobe` / `addStyledHair` with visibility toggles (`Hair_Long` / `Hair_Topknot` / `Hair_Bun`). `setFirstPersonHide` should also hide `Hair_*` and `Acc_Hairpiece`.
5. Use `gltf.animations` (`Idle`, `Walking_A`, `Dance`, `Run`) instead of `buildHumanClips`. The rest pose is already arms-down. See `clips.md` for foot-lock speeds.
6. Use `SkeletonUtils.clone` (as now). Keep `frustumCulled = false` on skinned meshes.
7. Physics: see `secondary-bones.md`.

## Files

- `renders/contact_sheet.png`: everything on one sheet (reference vs female, turnarounds idle/walk/dance for HQ and LITE, face close-ups with all hair variants)
- `renders/female_vs_reference.png`, `renders/<g>_<q>_<clip>_full<yaw>.png`, `renders/<g>_<q>_hair<Variant>_face<yaw>.png`, `renders/<g>_<q>_run_full*.png`
- `LICENSES.md`, `npc-plan.md`, `secondary-bones.md`, `clips.md`, `stats.md`
- Pipeline (re-runnable): `work/prep_tex.py`, `work/prep_pattern.py`, `work/build.py` (+ `build_robe.py`, `build_hair.py`, `build_anim.py`, `build_export.py`), `work/post.sh`, `work/buildall.sh`; previews: `viewer/` (three r160 + headless Chrome, game lighting copied from index.html)
- Rebuild everything: `cd work && ./buildall.sh && cd ../viewer && ./render_all.sh`
