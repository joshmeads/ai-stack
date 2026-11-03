# Mini-GDD template

Use this short format when the user asks for a mini-GDD, a one-page design brief, or a design doc for someone else to read, rather than a build source of truth. Aim for about five paragraphs of substance, giving more space to the sections that carry the game: a puzzle game needs detailed rules, an action game needs detailed controls and feel.

The same rules apply as for the full GDD: concrete numbers, exact win and lose conditions, no invented systems. If a listed item does not apply, say so in one line ("No health: a collision ends the run").

```markdown
# <Game name>

<One sentence: what the game is and what the player does.>

## Core Gameplay
- **Game play:** what a typical session feels like from the player's side, from the first input to the end.
- **Game elements:** the main activities the player does for fun.
- **Gameplay rules:** how the player wins, loses and progresses, stated exactly.
- **Game play outline:** opening → playing → ending, including restart.

## Player Mechanics
- **Player overview:** who or what the player controls.
- **Player mechanics:** main actions, and how health, damage or weapons work if the game has them.
- **Player properties:** attributes that change during play, and how each change is shown.
- **Player rewards:** pick-ups, power-ups or unlocks, and what each does.

## GUI
- **Player controls:** the input for every action above. Every action needs a control; every control needs an action.
- **Menus:** essential options in the main, pause and settings menus. Each option leads somewhere that exists.
- **In-game HUD:** information shown during play (score, health, timer, objective).
- **Interaction prompts:** how the game shows that an action is available.
- **Win and lose screens:** what the player sees and can do after the end.

## Artistic Direction
- **Visual style:** characters, environments and interface, including the palette.
- **Sound and music:** music and effects, and which events trigger them.
- **Mood and atmosphere:** the feeling the art and audio should create.

## Reference images
### <Purpose, e.g. "Menu layout", "HUD density", "Palette">
<Image or link.> <One or two sentences on which element to take from it.>

## Brief requirements
| Requirement (brief's words) | Covered in |
| --- | --- |
```

Reference rules:

- Use images and links the user supplied, ones approved from `image_gen`, or pages you opened yourself. Never invent a URL or describe an image you have not seen.
- Show elements relevant to this game, not general mood pictures.
- If no images are available, write a reference brief under the same headings: what to look for and why.
- References guide style and technique. Do not copy their art, names or layouts into the game.

Omit the **Brief requirements** table when the game does not come from a written brief.
