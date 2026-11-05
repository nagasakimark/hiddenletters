# Hidden Letters

Students find letters hidden in pictures. **Tap** the letter, then **press that letter's key** to prove they know what it is.

Plain HTML5 canvas, no build step, no dependencies. Open `index.html` or serve the folder (GitHub Pages works).
Direct links: `…/#january`, `…/#general-4` (or `?level=january`).

## Levels

| Group | What the student does |
|---|---|
| **Months** (Calendar + January–December) | Spell the word: find its letters **in order**. The next letter is shown and highlighted. |
| **Find all 26 letters** (7 pictures) | Find A–Z in any order, or in A→Z order (pill buttons on the menu). |
| Holidays | Not added yet – see below. |

Stars: 3 / 2 / 1 depending on mistakes (a hint counts as 2 mistakes). Best stars and time are saved in the browser.

## Anti-spam rules (tune them in `CFG` at the top of `js/game.js`)

* A key press does **nothing** unless a letter has just been spotted by tapping it.
* Tapping empty space, tapping a letter that isn't next (spelling levels), or pressing a wrong key is a **mistake**.
* **3 mistakes within 6 s freezes the picture** for 3 s, then 5 s, 8 s, 12 s on later freezes.
* **3 wrong keys** on one spotted letter drops it; the student has to tap it again.
* Holding a key down doesn't repeat. Works with a Japanese IME switched on.
* A **hint** (3 per level) glows near, not on, a letter.

## Overlapping circles

Circles are hand-drawn, so many overlap or sit inside each other (e.g. a small *A* inside a big *U*). Rules:

1. A tap **spots every unfound letter whose circle is under it** (each circle gets ~9 px of forgiveness for fingers).
2. **The key the student types decides which one they meant.** Type either letter and that one is found. The other stays available.
3. If two spotted circles have the *same* letter, the one whose **centre is closest to the tap** wins.
4. In **spelling levels only the next letter counts**, so a tap that doesn't touch it is a mistake even if another letter is there.
5. Already-found circles are ignored for matching (tapping them again is harmless and not a mistake).

Teacher view: open with `?teacher=1` and press **Shift+T** in a level to draw every circle with its letter.

## Data

`data/levels.js` is generated – don't edit by hand. To rebuild from the PDF and the marking-tool JSON:

```
python3 tools/build.py deck.pdf marks.json
```

(needs `pdftoppm` from poppler, and Pillow). It crops off borders/titles, handles February's swapped page order,
skips pictures with no marks yet, and applies `tools/fixes.json`.

**Corrections applied to the marks** (a mistyped key in the marking tool, checked against each picture):

| Level | Marked | Now | Why |
|---|---|---|---|
| Calendar | p | **d** | needs a D; the shape is a tilted D |
| January | q | **a** | needs a second A; the bell is a tilted a |
| October | r | **e** | needs an E; the shape on the bag is an e |
| November | r | **e** | needs a second E |

February has one more **Y** than the word needs (both are real). Either one counts; the spare one is revealed at the end.

## Adding the holidays

Mark them in the marking tool, then run `tools/build.py` again. Holiday levels use the *spelling* mode, so give each a title like
`Christmas (クリスマス)`. The title in English is the word the students spell.
