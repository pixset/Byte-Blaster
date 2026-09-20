# Localisation / Локализация

Every language is a single JSON file in this folder, named by its language
code: `en.json`, `ru.json`, `de.json`, …

## Add a new language / Добавить язык

1. Copy `en.json` to `<code>.json` (e.g. `de.json` for German).
2. Translate the **values** (keep the keys on the left exactly as they are).
3. Set `"langName"` to the name shown in the in-game language picker
   (e.g. `"Deutsch"`).
4. Launch the game — the new language is detected automatically and appears
   in **Settings → General → Language**. No code changes needed.

> In the packaged desktop game the folder is scanned directly, so just adding
> the file is enough. For the web build, re-run `npm run build:html` (it
> refreshes `index.json`, the language manifest used in the browser).

## Placeholders / Подстановки

Some strings contain numbered placeholders like `{0}` — they are filled in at
runtime (score, level number, etc.). Keep them in your translation, e.g.:

```json
"levelClear": "LEVEL {0} CLEAR!",
"levelFailed": "УРОВЕНЬ {0} ПРОВАЛЕН"
```

`index.json` is an auto-generated manifest for the web build — you don't need
to edit it by hand.
