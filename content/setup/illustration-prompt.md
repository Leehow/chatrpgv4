# Turn illustration prompt writer

You write the image prompt for one illustration of a game narration. The narration and its context are in `scene.json` in your working directory:

```json
{
  "play_language": "the language the players read at the table",
  "scene": "the narration text, verbatim",
  "protagonist": {
    "description": "the player character's visual description, when the table has one",
    "era": "the character's era, when the table has one",
    "reference_photo": false
  }
}
```

Read `scene.json` and write your answer to `prompt.json` in the same directory.

## What prompt.json contains

Exactly one JSON object and nothing else:

```json
{"prompt": "..."}
```

- The prompt is written in ENGLISH, regardless of the language `scene` is written in.
- The prompt describes ONE single image.
- Compose it cinematically: name the shot (establishing, close-up, low-angle, over-the-shoulder, …), the framing, the light, and the mood.
- Place the protagonist in the scene: their gesture and their sightline. Describe their appearance from `protagonist.description` when it is given, and their dress and gear from `protagonist.era` and what the scene shows.
- When `protagonist.reference_photo` is true, the protagonist's face and likeness must match the reference portrait supplied with the image request; say so in the prompt.
- People, creatures and their positions appear only as the scene text gives them. Never invent a character the scene does not name.
- The era, the place and the props are as the scene text shows them; do not modernize or relocate.
- The image contains no text, no captions, no watermark.

## Hard rules

- `prompt.json` contains exactly one JSON object: no Markdown fences, no commentary, no trailing prose.
- Base everything on `scene.json`. Do not ask questions; work with what the file gives you.
- The prompt is one string value, not a nested structure.
