# Plant Bingo (/moplants): plain-English notes

## What changed

There is a new plant bingo game at **/moplants** on the same site as the Osa
wildlife bingo. The Osa game at the main address works exactly as before.

- The card has all 25 plants from the handwritten list in a 5 x 5 grid, with
  no free space. Every card has the same 25 plants. "New card" shuffles them.
- Tap a plant to mark it found. Tap the small **i** to see a photo, both
  names, a fun fact, where the fact came from, and a link to the Missouri
  Botanical Garden Plant Finder.
- Five in a row, a column or a diagonal lights up and shows a **bingo** banner.
- The phone remembers the card and the marks, even after closing the browser.
- It follows the phone's light or dark setting. Menu > Theme switches it by hand,
  which helps in bright sun.
- It needs an internet connection. It does not work offline.

## How to preview it

Ask Victor to run this on his computer:

```bash
npm run dev
```

Then open <http://localhost:8787/moplants/> in a browser.

## How to put it live

Ask Victor to run:

```bash
npm run deploy
```

This checks both games first and only publishes if everything passes. After
that the game is at the site's address with `/moplants` on the end.

If you used the Osa game on a phone before, the very first visit to /moplants
on that phone may briefly show the Osa page. Reload once and it is fixed for
good.

## Plants that need your decision

These are marked **Name not confirmed** in the game until you decide:

1. **Pink Lemonade.** Assumed to be the pink blueberry. There is also a
   false indigo (Baptisia) called 'Pink Lemonade'. Which one is it?
2. **Pretty & Pink Epimedium.** Assumed to be Epimedium 'Pretty in Pink'.
3. **Girard Azalea.** Which one? For example Girard's Crimson, Fuchsia, Rose
   or Scarlet. Knowing the color would let the photo match.
4. **Lipstick Hosta.** No hosta called just 'Lipstick' turned up. Is it
   'Lipstick Blonde' (gold leaves, red stems) or 'Lipstick Blush'?
5. **Sambucas.** Assumed to be elderberry, most likely the native American
   elder. If it has a name like BLACK LACE, say so.
6. **Lemon Perfection Catmint.** The catmint sold today is spelled
   'Lemon Purrfection', so that is what the game uses.

Checked and fine: Emerald Spreader yew is a Japanese yew (*Taxus cuspidata*
'Monloo'). 'Arnold' tulip tree is the same tree as 'Fastigiatum'. Hummelo is
listed under both *Stachys* and *Betonica*, and the game shows both names.

## Photos

Every plant has a real, freely licensed photo from Wikimedia Commons. None
are placeholders. These show a close relative instead of the exact plant,
and the game says so on each one:

- **Species only:** Pretty in Pink Epimedium, Sugar Shack Buttonbush, Emerald
  Spreader Yew, Storm Cloud Bluestar
- **A related plant:** Pink Lemonade (a regular blue blueberry), Lipstick
  Hosta (a different gold hosta), Lemon Purrfection Catmint (a regular blue
  catmint), Girard Azalea ('Girard's Rose', which may not be the right color)
- **"Any" plants:** Espalier/Topiary shows an espaliered fruit tree, and
  Weeping Tree shows a weeping cherry. Any example in the garden counts.

If you have your own photos of the real plants, they can replace any of these.
Full photo credits are in `CREDITS-moplants.md` and at the bottom of the game.
