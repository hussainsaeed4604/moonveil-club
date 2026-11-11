# GLB stats (all in /workspace/forge/out/)

Every file has the same 9 materials (`SKIN, SKIN_FACE, FACE, HAIR, ACCENT, ROBE_INNER, ROBE, ACCENT_PATTERN, ROBE_SHEER`), 6 WebP textures (HQ 2048 max, LITE 1024 max), and the clips `Idle 4.000 s`, `Walking_A 1.000 s`, `Dance 4.000 s`, `Run 0.667 s`. `extensionsRequired`: plain = `EXT_texture_webp, KHR_mesh_quantization`; `_meshopt` also needs `EXT_meshopt_compression`.

| file | size | tris total (all 3 hair variants) | visible tris Long / Topknot / Bun | joints | J_Sec bones |
|---|---|---|---|---|---|
| female_hq.glb | 2.72 MB (2,716,964 B) | 73,710 | 71,198 / 63,590 / 63,078 | 142 | 75 |
| female_lite.glb | 1.47 MB (1,469,516 B) | 20,544 | 19,400 / 18,936 / 18,832 | 142 | 75 |
| male_hq.glb | 1.98 MB (1,975,272 B) | 55,960 | 54,900 / 51,332 / 51,280 | 112 | 45 |
| male_lite.glb | 1.1 MB (1,100,564 B) | 15,945 | 15,461 / 14,833 / 14,781 | 112 | 45 |
| female_hq_meshopt.glb | 1.68 MB (1,679,556 B) | 73,710 | 71,198 / 63,590 / 63,078 | 142 | 75 |
| female_lite_meshopt.glb | 1.07 MB (1,072,208 B) | 20,544 | 19,400 / 18,936 / 18,832 | 142 | 75 |
| male_hq_meshopt.glb | 1.14 MB (1,142,492 B) | 55,960 | 54,900 / 51,332 / 51,280 | 112 | 45 |
| male_lite_meshopt.glb | 0.77 MB (774,156 B) | 15,945 | 15,461 / 14,833 / 14,781 | 112 | 45 |

HQ and LITE of the same gender have identical joint names, material names and clip names.
