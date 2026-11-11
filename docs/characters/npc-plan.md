# Moonveil Club: five regulars built from the two bases

Bases: `out/female_{hq,lite}.glb` and `out/male_{hq,lite}.glb`. Desktop builds use `_hq`. iPhone testing uses `_lite`. Both have the same bones, material names and clips.

**Tinting.** Use `material.color.set(hex)` on the materials listed below. `SKIN` and `SKIN_FACE` take the same value. `ROBE` has a texture whose luminance averages about 0.85, so the shown robe is roughly 15% darker than the hex. The values below are what to pass to `material.color`. `ROBE_SHEER` is alpha-blended (opacity 0.30). `ACCENT` and `ACCENT_PATTERN` both take the accent hex.

**Hair toggle.** `Hair_Base` (bangs and cap) is always visible. Show exactly one of `Hair_Long`, `Hair_Topknot` or `Hair_Bun`. `Acc_Hairpiece` exists on the female base only and can be hidden.

**Hair colors.** Very dark hair (for example `0x141414`) renders as a flat black blob under the club's purple lighting. The values below lift it slightly so the strand highlights still read.

| NPC | Base | Hair | SKIN / SKIN_FACE | HAIR | ROBE | ROBE_SHEER | ROBE_INNER | ACCENT (+ACCENT_PATTERN) | Height (`look.height`) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Lyra**, jade bard | female | `Hair_Long` + `Acc_Hairpiece` | `#f3c7a8` | `#2a1d24` | `#2f9a6c` | `#9fe0c4` | `#f2efe4` | `#e8d59a` | 1.70 |
| **Vesper**, blue scholar | male | `Hair_Topknot` (gold guan built in) | `#e4c2a2` | `#1e1c2a` | `#2a3a70` | `#9aaee0` | `#eef0f6` | `#d4b15a` | 1.78 |
| **Rowan**, pale sword cultivator | male | `Hair_Long` (half-up tie) | `#d8b394` | `#2c2118` | `#e8edf6` | `#f4f7fc` | `#ffffff` | `#9a3434` (crimson trim) | 1.82 |
| **Lumi**, pink priestess | female | `Hair_Bun` (with tassels) + `Acc_Hairpiece` | `#ffe0d2` | `#f0d48a` | `#f0a8d2` | `#ffd6ec` | `#fff6fa` | `#fff1c4` | 1.62 |
| **Grokk**, green hearth keeper | male | `Hair_Topknot` | `#c6d2a6` | `#24180f` | `#467a40` | `#b4d29c` | `#efe8d6` | `#d7b15a` | 1.90 (uniform scale; slightly widen with `scale.x/z = 1.08` for a stockier build) |

## Accessories (game-side props parented to bones)

- **Lyra:** a small pipa or guqin prop. Hold it in the left hand (`J_Bip_L_Hand`) while idle, or sling it on `J_Bip_C_UpperChest`. Hairpiece stays on.
- **Vesper:** a rolled scroll on `J_Bip_R_Hand` and a book at the booth. The guan is already in `Hair_Topknot`. Drop the old procedural "crown".
- **Rowan:** a sword in a scabbard on `J_Bip_C_UpperChest`, offset behind and angled about 25°. A pale ribbon on the hilt can use `ROBE_SHEER`. Crimson ACCENT trim.
- **Lumi:** a small bell staff or lantern on `J_Bip_R_Hand`. Hide the hairpiece tassels if they clash with the bun tassels.
- **Grokk:** a ladle or teapot on `J_Bip_R_Hand` at the bar. No hairpiece. A cloth apron could later be a recolored `Robe_Sheer` duplicate.

## Idle behavior (clips: `Idle` 4 s, `Walking_A` 1 s, `Dance` 4 s, `Run` 0.667 s)

| NPC | Default | Behavior |
| --- | --- | --- |
| Lyra | `Idle` on stage | Every 20–40 s, cross-fades (0.4 s) into `Dance` for one or two loops, as if performing. Turns toward the player within 4 m. |
| Vesper | `Idle` seated or standing at the booth | Slower idle (`timeScale` 0.8). Occasional head turn toward the player. Rarely walks. |
| Rowan | `Idle`, `timeScale` 0.9 | Patrols two waypoints with `Walking_A` at the matched speed (see `clips.md`). Pauses 6–10 s at each. |
| Lumi | `Dance` (existing `dance: true`) | Dances when not walking. Blends to `Idle` when the player talks to her. |
| Grokk | `Idle` behind the bar, `timeScale` 0.85 | Short walks along the bar. Never dances. |

Blink: drive the `blink` morph target (index in `mesh.morphTargetDictionary.blink`) for 0.12 s every 3–6 s. `fun` is preset to 0.30 for a soft smile. `aa` can flap during dialogue.
