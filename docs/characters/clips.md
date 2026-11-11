# Animation clips (embedded in every GLB)

All clips are on the `J_Bip_*` bones only. `J_Sec_*` bones are never keyed, so they stay free for physics. Every clip is an **in-place loop**: the root never translates, and the Hips bone only bobs up and down and side to side. Rest/bind pose is relaxed with the arms down, so do **not** run the old `buildHumanClips` (it adds about 73° to the upper arms). Use `gltf.animations` instead.

| Clip | Duration | Loop | Notes |
| --- | --- | --- | --- |
| `Idle` | 4.000 s | seamless | breathing, slight sway, head drift |
| `Walking_A` | 1.000 s (1 cycle = 2 steps) | seamless | thigh ±21°, arm swing ±13° (kept small for the wide sleeves) |
| `Dance` | 4.000 s | seamless | slow sleeve dance: alternating arm raises, hip sway, knee dips |
| `Run` (optional, for Shift sprint) | 0.667 s (1 cycle = 2 steps) | seamless | thigh 8±34°, forearms at 55°, forward lean, bigger bob |

## Foot-lock ground speed

Measured in Blender by sampling the planted toe (`J_Bip_*_ToeBase`) 240 times per cycle and taking the median backward speed. At this ground speed the planted foot stays fixed on the floor.

| Base | Native model height (top of hair) | `Walking_A` stride per cycle | **Walk ground speed** | `Run` stride per cycle | **Run ground speed** |
| --- | --- | --- | --- | --- | --- |
| female | 1.650 m | 1.233 m @ 1.0 cycles/s | **1.23 m/s** | 1.972 m @ 1.5 cycles/s | **2.96 m/s** |
| male | 1.807 m | 1.362 m @ 1.0 cycles/s | **1.36 m/s** | 2.214 m @ 1.5 cycles/s | **3.32 m/s** |

These numbers are for the GLB at scale 1. `adornFigure` rescales each figure to `look.height`, so multiply by the uniform scale the game applies:

```js
const WALK_MPS = { female: 1.2326, male: 1.3615 };   // at model.scale = 1
const RUN_MPS  = { female: 2.9575, male: 3.3214 };
// After adornFigure sets model.scale:
const s = model.scale.x;
// Option A (recommended): play at timeScale 1 and move the character at the matched speed
const walkSpeed = WALK_MPS[gender] * s;   // e.g. Lyra (1.70 m look.height) is about 1.2-1.3 m/s
// Option B: keep the game's chosen speed and retime the clip to it
walkAction.setEffectiveTimeScale(gameSpeed / (WALK_MPS[gender] * s));
runAction.setEffectiveTimeScale(sprintSpeed / (RUN_MPS[gender] * s));
```

Keep `timeScale` between about 0.7 and 1.3. A slower walk (for example 0.9 m/s) means `timeScale` ≈ 0.73. Below about 0.6, blend toward `Idle` instead. The numbers come from `work/out/clips_<gender>_<q>.json`, which the build writes automatically.
