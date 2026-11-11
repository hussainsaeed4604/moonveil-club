# Secondary (physics) bone chains

Every GLB (`*_hq`, `*_lite`, plain and meshopt) contains VRoid/UniVRM-style secondary chains. They are **not keyed in any clip**: at rest they follow their parent rigidly, and a physics pass (spring bones or Verlet) can swing them. Garments are skinned to them as described below, so sway shows up on the mesh with no other changes.

Chain heads are at the listed parent. Each bone's rest direction points down the garment toward the tip. Bone names are identical in HQ and LITE except where noted.

## Chains

| Group | Chain root names (bones per chain) | Parent | Skinned meshes | Count |
| --- | --- | --- | --- | --- |
| Skirt | `J_Sec_SkirtF1..3`, `SkirtFR`, `SkirtR`, `SkirtBR`, `SkirtB`, `SkirtBL`, `SkirtL`, `SkirtFL` (3 each). 8 chains at 45° steps, F = front, R = wearer's right. | `J_Bip_C_Hips` | `Robe` (below the waist), `Robe_Pattern`, `Robe_Trim` hem, `Robe_Sheer` (overskirt / male coat), waist chains | 8 × 3 = 24 |
| Sleeves | `J_Sec_Sleeve_L1..3`, `J_Sec_Sleeve_R1..3` | `J_Bip_L/R_LowerArm` | `Sleeves_Sheer`, and the outer drape of `Sleeves` (male). The arm-hugging part stays on the arm bones. | 2 × 3 = 6 |
| Hair, back | `J_Sec_HairBackL1..3`, `J_Sec_HairBackC1..3`, `J_Sec_HairBackR1..3` | `J_Bip_C_Head` | `Hair_Long` curtain (about 35% blended with `UpperChest` lower down, so it also follows the torso without physics) | 3 × 3 = 9 |
| Hair, front locks | female (HQ and LITE): `J_Sec_HairFrontL1_1..3`, `L2_1..3`, `R1_1..3`, `R2_1..3`; male: `J_Sec_HairFrontL1..2`, `R1..2` | `J_Bip_C_Head` | `Hair_Long` front locks | F 12, M 4 |
| Tassels | `J_Sec_Tassel01_1..2` … `J_Sec_Tassel08_1..2` (waist, skirt and sleeves); `J_Sec_TasselBunL/R_1..2` (bun tassels); `J_Sec_TasselHairpiece1/2_1..2` (hairpiece) | the bone that carries the tassel top: `J_Bip_C_Spine`, `J_Bip_C_Hips`, a skirt chain bone, `J_Bip_L/R_LowerArm`, or `J_Bip_C_Head` | `Jewelry`, `Hair_Bun`, `Acc_Hairpiece` (tassel cords and threads) | female 12 chains × 2 = 24; male 1 chain × 2 = 2 (jade pendant) |

Totals (measured from the shipped GLBs): **female 75** `J_Sec_*` bones (skirt 24, sleeve 6, hair back 9, hair front 12, tassel 24) out of 142 joints. **Male 45** (skirt 24, sleeve 6, hair back 9, hair front 4, tassel 2) out of 112 joints. HQ and LITE have identical bone names.

## Suggested spring parameters

The values follow the UniVRM `VRMSpringBone` convention (stiffness 0–4, dragForce 0–1, gravityPower, hitRadius in meters). Drag = velocity damping per frame at 60 fps.

| Group | stiffness | drag | gravityPower (dir −Y) | hitRadius | Colliders to test against |
| --- | --- | --- | --- | --- | --- |
| Skirt chains | 1.2 (root) → 0.8 (tip) | 0.45 | 0.15 | 0.06 | spheres on `J_Bip_L/R_UpperLeg` (r 0.09), `J_Bip_L/R_LowerLeg` (r 0.07), `J_Bip_C_Hips` (r 0.14) |
| Sleeve chains | 0.9 | 0.40 | 0.20 | 0.05 | `J_Bip_C_Hips` (r 0.16), `J_Bip_L/R_UpperLeg` (r 0.09) |
| Hair back | 0.8 | 0.35 | 0.10 | 0.04 | `J_Bip_C_Head` (r 0.11), `J_Bip_C_UpperChest` (r 0.13), `J_Bip_C_Neck` (r 0.06) |
| Hair front locks | 1.0 | 0.40 | 0.10 | 0.02 | `J_Bip_C_UpperChest` (r 0.12), `J_Bip_C_Chest` (r 0.12) |
| Tassels | 0.5 | 0.25 | 0.35 | 0.01 | none, or `J_Bip_C_Hips` for waist tassels |

Tips:
- Clamp each bone's swing to about 35° (skirt), 45° (sleeves, tassels) and 30° (hair) so nothing flips through the body during `Dance`/`Run`.
- The skirt is also partly skinned to the thighs (about 40% at the hem), so it opens for the legs even with physics off. Physics should add to that motion, not replace it.
- On iPhone, simulate only the skirt and the three back-hair chains, or drop to 30 Hz.
