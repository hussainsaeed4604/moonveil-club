# Moonveil Club multiplayer (phase 1)

Accounts, presence, friends, and cloud saves on Supabase. The game page (`index.html`) is unchanged in this change. Wire the modules below into it when the account flow is ready.

`js/net/config.js` already holds the public project URL and the anon/publishable key. Those values are meant to ship in the browser. Never put a secret key or the `service_role` key in this repo.

## What Hussain pastes and clicks

1. Open the Supabase dashboard for this project.
2. Go to **SQL Editor → New query**.
3. Paste the entire file `supabase/setup.sql` and run it. The same SQL is in `supabase/migrations/20261110170000_phase1_multiplayer.sql` if you use the Supabase CLI instead. Running it again is safe.
4. Open **Authentication → Providers → Email** (sometimes labeled **Sign In / Providers**).
   - Leave the Email provider **enabled**.
   - Turn **Confirm email** **off**.
   Username accounts do not have a mailbox. With confirmation left on, `signUp` creates a user that can never sign in. The adapter stores `<username>@players.moonveil.club` when no email is passed (see below).
5. Open **Project Settings → API** (or the **Connect** dialog).
   - `SUPABASE_URL` in `js/net/config.js` must be the **Project URL** (`https://<project-ref>.supabase.co`), not the address of a dashboard page.
   - `SUPABASE_ANON_KEY` must be the **publishable** key (`sb_publishable_...`) or the legacy anon key.
   - If the game fails before Auth responds at all, replace only the URL with the Project URL from this screen. Do not commit a secret key.
6. Leave **Realtime → Settings → Allow public access** enabled unless you have moved every other channel to private. The club list joins `club:main` as a **private** channel. `setup.sql` adds the `realtime.messages` policies that let a signed-in player publish and receive presence there. Turning public access off rejects any client that does not opt into private channels.
7. Optional: **Authentication → URL Configuration → Site URL** = the GitHub Pages origin (for example `https://<user>.github.io`). Username sign-in does not use a redirect when email confirmation is off.

You only have the anon key in this repo, so the SQL editor step cannot be done from the test script.

## Username sign-in

Supabase Auth asks for an email. `js/net/authSupabase.js` maps a username onto one:

- `signUp('Luna_1', password)` stores the auth email `luna_1@players.moonveil.club` and writes `username: "luna_1"` into user metadata. The database trigger copies that into `profiles`. Usernames are lowercased and limited to 3–20 characters matching `[a-z0-9_]`.
- `signIn('Luna_1', password)` rebuilds that same address.
- `signUp('Luna_1', password, 'luna@example.com')` stores the real email instead. That player signs in with `luna@example.com` (any identifier that contains `@`). Signing in with the username would look for the synthetic address, which was not created.
- `players.moonveil.club` is not a mailbox this project reads. That is why confirmation must be off.

The profile trigger rejects a sign-up whose username is missing or already taken, and the auth user is rolled back with it.

## Frontend wiring

Serve the game over `http` or `https` (GitHub Pages). ES modules do not load from a `file://` page. From a module script in `index.html`:

```javascript
import {
  signUp,
  signIn,
  signOut,
  getUser,
  onAuthChange,
  loadSave,
  saveSave,
  loadCharacter,
  saveCharacter,
  updateDisplayName,
} from './js/net/authSupabase.js';

import {
  connectPresence,
  disconnectPresence,
  getOnlinePlayers,
  onPresenceChange,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  blockUser,
  unblockUser,
  unfriend,
  listFriends,
  listFriendRequests,
  listBlocked,
  submitReport,
} from './js/net/presence.js';
```

`authSupabase.js` loads `@supabase/supabase-js` 2.119.0 from `esm.sh`. The page does not need an import map for it.

Suggested boot, after the local account screen calls the same function names:

```javascript
const stop = onAuthChange((user) => {
  // user is { id, username, displayName, email } or null.
  // This callback must not await other Supabase calls; the auth client holds a lock here.
  // Read saves and join the club from getUser() outside this callback, or defer with queueMicrotask.
});

const existing = await getUser();
if (existing) {
  const character = await loadCharacter();
  const save = await loadSave();
  await connectPresence({
    userId: existing.id,
    displayName: existing.displayName,
    character,
    status: 'online',
  });
}

onPresenceChange((event) => {
  // event.type is 'join', 'leave', or 'sync'
  // event.player is the one who joined or left (null on sync)
  // event.players is the full online list:
  //   { userId, displayName, username, character, status }
});
```

On the way out, disconnect before signing out so the tab drops off the list:

```javascript
await disconnectPresence();
await signOut();
stop();
```

Swap point: import the local auth module and this one under the same names, and pick one. `createAuthApi(client)` and `createPresenceApi(client)` build the same functions against a specific client. The named exports use the shared browser client in `js/net/supabaseClient.js`.

### Calls

| Call | Result |
| --- | --- |
| `signUp(username, password, email?)` | `{ user, needsEmailConfirmation }`. `needsEmailConfirmation` must stay false in this project. |
| `signIn(usernameOrEmail, password)` | `{ id, username, displayName, email }` |
| `signOut()` | resolves when the session is gone |
| `getUser()` | the same user object, or `null` |
| `onAuthChange(listener)` | returns `unsubscribe`. The listener is `(user, event)`. `user` here is built from the session, not a profile fetch. |
| `loadSave()` | `{ data, version, updatedAt }` or `null` |
| `saveSave(data, version?)` | same shape. `data` is a JSON object, at most 200k characters. Omit `version` to increment. |
| `loadCharacter()` | the appearance object, or `null` |
| `saveCharacter(character)` | one row per profile; saving again overwrites it |
| `updateDisplayName(name)` | updates `profiles.display_name`. The username does not change. |

Character object, in both saves and presence:

```javascript
{
  gender: 'female', // 'male' or 'female'
  skin: '#f0c0a0',
  hairStyle: 'long',
  hairColor: '#2a1a12',
  outfitColor: '#6b3fa0',
  name: 'Lyra',
}
```

`gender` is only `male` or `female`. Colors and style ids are short strings (1–32 characters). The character name is 1–24 characters. It is separate from the account display name; copy one into the other in the game if they should match.

Friends:

```javascript
await sendFriendRequest('lyra');
const { incoming, outgoing } = await listFriendRequests();
await acceptFriendRequest(incoming[0].id);
await declineFriendRequest(incoming[0].id); // addressee, while pending
await cancelFriendRequest(outgoing[0].id);  // requester, while pending

const friends = await listFriends();
// friends[0].online and friends[0].status come from presence
// friends[0].character is the public appearance row

await blockUser('grokk');
await unblockUser('grokk');
await unfriend(friendshipId);
await submitReport(playerId, 'Reason the moderators should see.');
```

`listFriends()` returns accepted friends only. A block removes that pair from the friend list. Only the player who blocked can delete the row. The blocked player cannot accept their way out, and a new request fails while the block row exists.

Reports are visible to the reporter only. The target cannot read them.

### Presence

`connectPresence` tracks on `club:main` with `{ userId, displayName, character, status }`. Status defaults to `online`. Any 1–16 character token of letters, numbers, `_`, and `-` is allowed (`away`, `busy`, `dancing`).

The online list dedupes by user id, so two tabs do not look like two players. Names and outfits are re-read from `profiles` and `characters` when presence syncs. The track payload is still chosen by the client, so "online" is a hint, not proof of identity.

An empty `sync` after `disconnectPresence` means this tab left the channel. It does not mean the club is empty.

## Tables and access

| Table | Who can read | Who can write |
| --- | --- | --- |
| `profiles` | anyone can read `id`, `username`, `display_name` | the owner can update `display_name` only. Insert is the sign-up trigger. Username is immutable from the API. |
| `characters` | anyone can read appearance and `profile_id` | the owner can insert, update, and delete their one row |
| `saves` | the owner | the owner |
| `friendships` | the two participants | requester creates `pending` (or a block). Addressee can accept. Either participant can block. Pending and accepted rows can be deleted by either side. A block can be deleted only by `blocked_by`. |
| `reports` | the reporter | the reporter can insert and delete |

`created_at` on a profile is not granted to the browser. There is one character and one save per profile.

Deleting an auth user in the dashboard cascades the profile, character, save, friendships, and reports.

## Test

```bash
npm install
npm run test:multiplayer
```

The script always applies `supabase/setup.sql` twice to a local in-memory Postgres and checks the policies. It then uses `js/net/config.js` and the real modules to sign up two throwaway players, write and read a save, check that the other player cannot read it, join `club:main`, friend each other, and delete the rows Row Level Security allows.

It does not run DDL against the hosted project. The anon key cannot. Exit codes:

| Code | Meaning |
| --- | --- |
| 0 | Hosted project passed signup, save, and presence |
| 2 | Project URL did not answer, or the SQL has not been applied yet |
| 3 | SQL is applied, but Confirm email is still on, so username sign-up was not attempted |
| 1 | A check failed |

Auth users created by a passed or half-finished run cannot be deleted with the anon key. Remove `mv…` users under **Authentication → Users**. Their profile rows go away with them. Saves, characters, friendships, and reports are deleted by the test when the policies allow it.
