# Moonveil Club

A fantasy first-person social browser game prototype. Wander a glowing lounge with a dance floor, bar, and stage, and make friends with the regulars: Lyra the elf bard, Vesper the wizard, Rowan the knight, Lumi the fairy, and Grokk the orc bartender.

![Desktop view of the Moonveil Club lounge](screenshots/desktop.png)

![Mobile view with the joystick and Talk button](screenshots/mobile.png)

Open the folder over HTTP (a local web server or GitHub Pages) and visit `index.html` in a modern browser, including iPhone Safari. The characters are local glTF files in `assets/`, so the page has to be served — opening it as a `file://` URL cannot load them.

## Characters

Lyra, Vesper, Rowan, Lumi, and Grokk are rigged humanoids loaded with Three.js `GLTFLoader` and played by an `AnimationMixer`. Idle, walk, and dance crossfade instead of swapping poses. Each figure has a head with a face, neck, torso, shoulders, arms and hands, and legs and feet.

| Regular | Model | What makes them them |
| --- | --- | --- |
| Lyra, elf bard | KayKit Rogue | Pointed ears and a lute |
| Vesper, wizard | KayKit Mage | Wizard hat, cape, and staff |
| Rowan, knight | KayKit Knight | Helmet, cape, sword, and shield |
| Lumi, fairy | KayKit Rogue (hooded), scaled down | Pink tint and glowing wings |
| Grokk, orc bartender | KayKit Barbarian, scaled up | Green skin, tusks, and a mug |

The dance clip is the pack's Cheer emote, renamed `Dance`. It is a full-body skeletal loop (arms, spine, and legs) and blends with idle and walk.

## Credits and licenses

Character models, textures, and animations are from **KayKit — Character Pack: Adventurers** by Kay Lousberg ([kaylousberg.com](https://kaylousberg.com/), [GitHub](https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0)).

License: **CC0 1.0 Universal** (public domain). Attribution is not required. A copy of the pack's license note is in `assets/licenses/kaykit-adventurers-CC0.txt`. The files in `assets/characters/` are trimmed copies: unused weapons and animation tracks were removed so the club stays light on phones. The meshes, rig, and the idle, walk, and dance performances are the original KayKit clips. Ears, lute, wings, tusks, Grokk's green skin tint, and Lumi's pink tint were added in the game.

## Desktop controls

- Move with **WASD** or the arrow keys
- Click to lock the cursor, then look around with the mouse
- Press **E** when you are near someone to talk
- Choose a reply with **1**–**3** or a click; **Esc** closes a chat
- Press **M** to toggle the club beat

## Touch controls (iPhone and other phones)

- Walk with the left joystick
- Drag on the right side of the screen to look around
- When you are close to someone, tap **Talk**
- Tap a reply, or **Close** to leave the conversation
- Tap **♪ Music** for a beat (after you start)

Goal: talk, dance, and make three friends.
