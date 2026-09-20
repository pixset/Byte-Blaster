# 🎵 MUSIC — Byte Blaster

> Полный список музыкальных тем игры и промты для **SUNO AI**, позволяющие пересоздать каждый трек в высоком качестве.

## Как устроена музыка сейчас

В игре **нет аудиофайлов**. Вся музыка генерируется процедурно во время выполнения через **Web Audio API** (осцилляторы `square` / `sawtooth` / `triangle` / `sine` + буфер шума). Движок и определения тем находятся в `index.html`:

- **Аудио-движок:** `index.html:573–620` (`initAudio`, `tone`, `sweep`, `noise`)
- **Музыкальный движок:** `index.html:655–703` (`_mTick`, `startMusic` и пр.)
- **Гейн-узлы:** `MUG` — музыка, `SG` — SFX, `MG` — мастер. Громкость музыки/эффектов регулируется в настройках (`assets/settings.js`).

Каждая тема — это объект с параметрами:

| Поле   | Назначение |
|--------|-----------|
| `bpm`  | темп (доли делятся ещё на 4 → шестнадцатые) |
| `base` | базовая частота тоники, Гц |
| `sc`   | лад/гамма (`PENT`, `MIN`, `HARM`, `CHR`, `DORI`) |
| `wave` | форма волны осциллятора (тембр) |
| `mel`  | мелодическая фраза (16 шагов, ступени гаммы) |
| `bass` | басовая линия (8 шагов) |

Лады (`index.html:657`):
- **PENT** — пентатоника (светлая, «весёлая»)
- **MIN** — минор (мрачная, напряжённая)
- **HARM** — гармонический минор (восточная, драматичная)
- **CHR** — хроматика (диссонанс, тревога)
- **DORI** — дорийский (эпичный, «средневеково-героический»)

> **Цель этого документа** — каждую процедурную тему заменить/дополнить полноценным треком, сгенерированным в SUNO AI, сохранив её настроение, темп и привязку к миру.

---

## 📋 Сводная таблица тем

| # | Трек | Где звучит | BPM | Лад | Тембр | Настроение |
|---|------|-----------|-----|-----|-------|-----------|
| 0 | **Menu Theme** | Главное меню | 118 | PENT | square | Спокойный, ламповый chiptune |
| 1 | **Cyber City** 🏙 | Миры 1–10 | 140 | PENT | square | Бодрый, неоновый, оптимистичный |
| 2 | **Neon Jungle** 🌿 | Миры 11–20 | 128 | MIN | sawtooth | Загадочный, влажный, ритмичный |
| 3 | **Lava World** 🌋 | Миры 21–30 | 162 | HARM | sawtooth | Жаркий, агрессивный, восточный |
| 4 | **Ice Caves** ❄ | Миры 31–40 | 112 | PENT | triangle | Холодный, чистый, медитативный |
| 5 | **Desert Ruins** 🏜 | Миры 41–50 | 133 | HARM | square | Древний, знойный, мистический |
| 6 | **Space Station** 🛸 | Миры 51–60 | 148 | CHR | sawtooth | Космический, тревожный, техно |
| 7 | **Dark Forest** 🌲 | Миры 61–70 | 116 | MIN | triangle | Тёмный, тягучий, сказочно-жуткий |
| 8 | **Toxic Zone** ☣ | Миры 71–80 | 155 | CHR | sawtooth | Кислотный, нервный, индустриальный |
| 9 | **Storm Peaks** ⚡ | Миры 81–90 | 168 | DORI | square | Героический, эпичный, грозовой |
| 10 | **Final Fortress** 🔱 | Миры 91–100 | 178 | HARM | sawtooth | Финальный, драматичный, монументальный |
| — | **Boss Theme** ⚔ | Бой с боссом | 195 | MIN | sawtooth | Скоростной, опасный, напряжённый |
| — | **Star Power** ⭐ | Звезда-неуязвимость | 240 | PENT | square | Сверхбыстрый, эйфоричный, мажорный |
| — | **Victory Theme** 🏆 | Финальная катсцена | 120 | PENT | triangle | Триумфальный, светлый, восходящий |

> ⚠️ **Замечание по коду:** массив `GMUSIC` (`index.html:659–674`) содержит 12 записей, но `startGameMusic` использует `GMUSIC[Math.min(CT.id,9)]` — индекс ограничен 9. Поэтому две последние записи (индексы 10 и 11, помеченные комментариями «Theme 8 – Storm Peaks» и «Theme 9 – Final Fortress») **никогда не воспроизводятся**. Миры 8 и 9 (Storm Peaks / Final Fortress) фактически играют `GMUSIC[8]` (168 BPM, дорийский) и `GMUSIC[9]` (178 BPM, гарм. минор). Промты ниже соответствуют тому, что **реально звучит** в игре по `CT.id`.

---

## 🎹 Общий стиль (приклеивать к любому промту)

Игра — пиксельный платформер в духе ретро-аркад. Чтобы новые треки совпадали с эстетикой, держите общий «зонтик»:

```
retro video game soundtrack, chiptune / synthwave fusion, 8-bit and 16-bit synths,
catchy loopable melody, tight arpeggios, punchy square-wave bass, no vocals, instrumental,
clean mix, suitable for a fast-paced pixel-art platformer
```

В SUNO: включайте режим **Instrumental**, в поле **Style** вставляйте промт, при желании добавляйте `[loop]` и тег нужного BPM.

---

## 🎼 Промты для SUNO AI

### 0. Menu Theme — Главное меню
- **Настроение:** уютный, ненавязчивый, приглашающий нажать «Старт».
- **Реф. параметры:** 118 BPM, пентатоника, square.

```
Style: chillwave chiptune main menu theme, relaxed 8-bit melody, warm square-wave lead,
gentle pentatonic hook, soft arpeggio pads, light shaker percussion, nostalgic and inviting,
loopable, instrumental, 118 BPM, retro pixel game menu
```

---

### 1. Cyber City 🏙 — Миры 1–10
- **Настроение:** яркий неоновый старт приключения, оптимизм, движение.
- **Реф. параметры:** 140 BPM, пентатоника, square.

```
Style: upbeat synthwave chiptune, neon cyberpunk city vibe, bright square-wave lead melody,
driving pentatonic hook, punchy 8-bit bass, retro drum machine, optimistic and energetic,
loopable platformer level theme, instrumental, 140 BPM
```

---

### 2. Neon Jungle 🌿 — Миры 11–20
- **Настроение:** влажные неоновые джунгли, загадка, упругий ритм.
- **Реф. параметры:** 128 BPM, минор, sawtooth.

```
Style: mysterious jungle synthwave, minor-key sawtooth lead, tribal electronic percussion,
bouncy bassline, dripping reverb plucks, lush dark-green atmosphere, retro 16-bit textures,
loopable adventure level theme, instrumental, 128 BPM
```

---

### 3. Lava World 🌋 — Миры 21–30
- **Настроение:** раскалённая лава, агрессия, восточно-драматичный накал.
- **Реф. параметры:** 162 BPM, гармонический минор, sawtooth.

```
Style: aggressive fast chiptune, harmonic-minor exotic melody, distorted sawtooth lead,
molten lava intensity, driving double-time bass, pounding 8-bit drums, heat and danger,
loopable action level theme, instrumental, 162 BPM
```

---

### 4. Ice Caves ❄ — Миры 31–40
- **Настроение:** ледяная чистота, простор пещер, медитативность.
- **Реф. параметры:** 112 BPM, пентатоника, triangle (мягкий тембр).

```
Style: cold crystalline chiptune, soft triangle-wave bells, airy pentatonic melody,
icy reverb, slow shimmering arpeggios, calm frozen-cave atmosphere, gentle 8-bit pads,
loopable ambient level theme, instrumental, 112 BPM
```

---

### 5. Desert Ruins 🏜 — Миры 41–50
- **Настроение:** древние руины под зноем, мистика, восточные мотивы.
- **Реф. параметры:** 133 BPM, гармонический минор, square.

```
Style: ancient desert chiptune, harmonic-minor middle-eastern scale, square-wave lead,
sun-scorched mystical mood, hand-drum-style 8-bit percussion, snake-charmer melody,
loopable exploration level theme, instrumental, 133 BPM
```

---

### 6. Space Station 🛸 — Миры 51–60
- **Настроение:** холодный космос, высокотехнологичная тревога, техно-драйв.
- **Реф. параметры:** 148 BPM, хроматика, sawtooth.

```
Style: dark sci-fi techno chiptune, chromatic dissonant sawtooth lead, sterile space-station mood,
pulsing electronic bass, robotic arpeggios, suspenseful zero-gravity atmosphere, retro synths,
loopable futuristic level theme, instrumental, 148 BPM
```

---

### 7. Dark Forest 🌲 — Миры 61–70
- **Настроение:** тёмный сказочный лес, тягучая жуть, тайна.
- **Реф. параметры:** 116 BPM, минор, triangle.

```
Style: eerie dark-forest chiptune, slow minor-key triangle-wave melody, haunting fairytale mood,
deep wooden bass, sparse echoing plucks, mysterious creepy atmosphere, 16-bit ambience,
loopable atmospheric level theme, instrumental, 116 BPM
```

---

### 8. Toxic Zone ☣ — Миры 71–80
- **Настроение:** кислотная индустрия, нервозность, диссонанс.
- **Реф. параметры:** 155 BPM, хроматика, sawtooth.

```
Style: gritty industrial chiptune, chromatic acid-synth sawtooth lead, toxic-waste atmosphere,
nervous syncopated bass, glitchy metallic percussion, hazardous unstable mood, distorted retro synths,
loopable intense level theme, instrumental, 155 BPM
```

---

### 9. Storm Peaks ⚡ — Миры 81–90
- **Настроение:** грозовые вершины, героика, эпичный подъём.
- **Реф. параметры:** 168 BPM, дорийский лад, square.

```
Style: heroic epic chiptune, dorian-mode square-wave lead, soaring mountain-storm melody,
thunderous driving bass, triumphant arpeggios, windswept high-altitude grandeur, retro 16-bit power,
loopable adventurous level theme, instrumental, 168 BPM
```

---

### 10. Final Fortress 🔱 — Миры 91–100
- **Настроение:** финальная крепость, драма, монументальность, кульминация.
- **Реф. параметры:** 178 BPM, гармонический минор, sawtooth.

```
Style: dramatic final-stage chiptune, harmonic-minor sawtooth lead, dark fortress grandeur,
relentless fast bass, ominous brass-like synths, climactic boss-approach tension, epic retro orchestration,
loopable finale level theme, instrumental, 178 BPM
```

---

### ⚔ Boss Theme — Бой с боссом
- **Настроение:** скоростная опасность, ставки максимальны.
- **Реф. параметры:** 195 BPM, минор, sawtooth, низкая база (110 Гц).

```
Style: high-energy boss battle chiptune, fast minor-key sawtooth riffs, low menacing bass,
relentless double-kick 8-bit drums, dramatic tension stabs, dangerous intense mood,
loopable boss fight theme, instrumental, 195 BPM
```

---

### ⭐ Star Power — Звезда-неуязвимость
- **Настроение:** эйфория всемогущества, сверхскорость, чистый мажор.
- **Реф. параметры:** 240 BPM, пентатоника, square, высокая база (329.63 Гц).

```
Style: euphoric super-fast chiptune power-up theme, bright major pentatonic square-wave melody,
hyper-speed arpeggios, bouncing happy bass, invincibility rush, joyful frantic energy, retro 8-bit,
short loopable power-up theme, instrumental, 240 BPM
```

---

### 🏆 Victory Theme — Финальная катсцена
- **Настроение:** триумф, светлый восходящий финал, чувство завершения.
- **Реф. параметры:** 120 BPM, пентатоника, triangle, 32-шаговая восходящая мелодия.

```
Style: triumphant victory fanfare chiptune, uplifting major pentatonic melody, warm triangle-wave lead,
rising heroic chord progression, celebratory bells, ending-cinematic grandeur, emotional resolution, retro 16-bit,
instrumental, 120 BPM
```

---

## 🔧 Как внедрить треки SUNO в игру (кратко)

1. Сгенерировать треки в SUNO, экспортировать в `.mp3` / `.ogg` (зацикленные версии — `loop`).
2. Положить в новую папку, например `assets/audio/music/`.
3. Заменить процедурный движок на `<audio>` / `AudioBufferSourceNode`, маршрутизируя звук в существующий гейн-узел музыки **`MUG`** (чтобы работал слайдер громкости музыки и общий mute).
4. Точки переключения треков уже есть — менять только источник звука:
   - `startMenuMusic()` → Menu Theme
   - `startGameMusic()` → тема по `CT.id`
   - `startBossMusic()` → Boss Theme
   - `startStarMusic()` → Star Power
   - `startVictoryMusic()` → Victory Theme
5. Не забыть про достижение **«Меломан / Music Lover»** (`assets/achievements.js`) — оно отслеживает прослушивание музыки всех 10 миров через `AchTrack.music(...)`.

См. также: [SOUNDS.md](./SOUNDS.md) — список всех звуковых эффектов.
