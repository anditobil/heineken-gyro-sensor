# Brand assets (drop official files here)

The game never draws brand logos itself. Put the official files in this folder with
these exact names. Each slot tries `.svg`, then `.png`, then `.webp`. Missing files
show a placeholder, so the game works without them.

| File name (no extension) | Where it appears | Suggested size |
|---|---|---|
| `heineken-house-logo` | Main menu (top), the top of the game box, and on the tile wall in the game | 600 × 300, transparent |
| `age-badge` | Top-right corner on every screen (21+ / responsible drinking badge) | 300 × 120, transparent |
| `sync-challenge-logo` | Main menu, under "READY TO PLAY?" | 800 × 450, transparent |
| `cheers-cans` | Success screen: two cans clinking, held by hands | 600 × 800, transparent |
| `can-label` | Wrap-around label of the can in the game (texture, wraps once around) | 1024 × 384 |
| `can-lid` | Can lid, faces the camera | 512 × 512, round artwork centred |
| `can-side` | The can lying on the board under the game box (it slides with the game) | 600 × 500, transparent, can lying down, lid toward the viewer |

Fonts are bundled from `src/assets/fonts/` (Futura Condensed Bold, Myriad Pro Regular,
Heineken Serif 18).
