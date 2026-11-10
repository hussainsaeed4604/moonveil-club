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

## Menus

The title screen has New Game, Continue (only after a save), Sign In, Settings, Credits, and Quit. New Game asks for an account first: username and password, email optional, or sign in, or skip and play as a guest. Character creation comes next, then the club. Esc opens the pause menu (Resume, Save, Settings, Main Menu). On a phone, use the Pause button. Menu screens fade in.

## You

Character creation is male or female, using the same KayKit rigs as the regulars (Rogue and Knight, without the knight's helmet and weapons). Pick a name, skin tone, hair style, hair color, and outfit color. The preview turns. In the club, look down to see your body and shadow. Press **V** for a third-person view. The regulars use your name when they talk.

## Saves and settings

Saves are version 1 JSON in `localStorage`, one per signed-in account (guests have their own slot). They store your character, position and look direction, each regular's friendship and whether you have talked, the win flag, and settings. The game autosaves, and pause has a Save button. Continue loads that save.

Settings cover render scale (50–100%), a device pixel-ratio cap, desktop resolution presets, Low/Medium/High graphics (fog, shadow map, and how many lights stay on), shadows, field of view, mouse and touch look sensitivity, invert Y, master/music/effects volume, an FPS counter, and fullscreen where the browser allows it.

## Accounts

There is no server. Sign-in goes through a small auth interface with a local adapter: accounts live in `localStorage`, and passwords are stored only as a SHA-256 hash plus a random salt (WebCrypto). A Firebase or Supabase adapter can replace `localAuth` later. The game only calls `signUp`, `signIn`, `signOut`, and `current`.

## Desktop controls

- Move with **WASD** or the arrow keys
- Click to lock the cursor, then look around with the mouse
- Press **E** when you are near someone to talk
- Choose a reply with **1**–**3** or a click; **Esc** pauses, or closes a chat
- Press **V** to toggle third person
- Press **M** to toggle the club beat

## Touch controls (iPhone and other phones)

- Walk with the left joystick
- Drag on the right side of the screen to look around
- When you are close to someone, tap **Talk**
- Tap a reply, or **Close** to leave the conversation
- Tap **Pause** for the pause menu
- Tap **♪ Music** for a beat (after you start)

Goal: talk, dance, and make three friends.
