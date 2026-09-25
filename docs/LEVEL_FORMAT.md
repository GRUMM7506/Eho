# Формат уровня

Уровень — JSON-файл `src/levels/worldN/levelM.json` (бонусные — `levelB1.json` и т. п. тоже
подходят под шаблон `level*.json`). Схема описана в `src/core/level.ts` (zod) и проверяется при
загрузке. Рядом лежит эталонное решение `levelM.solution.json`, которое пишет `npm run solve`.

```json
{
  "id": "w1-3",
  "world": 1,
  "index": 3,
  "name": { "ru": "Эстафета", "en": "Relay" },
  "map": [
    "#########",
    "#S..#...#",
    "#.a.A.bB#",
    "#...#..X#",
    "#########"
  ],
  "heights": ["000000000", "..."],
  "legend": { "k": { "type": "key", "color": "pink" } },
  "tickLimit": 30,
  "maxEchoes": 3,
  "par": { "echoes": 2, "ticks": 14 },
  "hints": [{ "text": { "ru": "…", "en": "…" }, "touch": { "ru": "…", "en": "…" }, "arrow": [2, 2] }],
  "camera": { "yaw": 45 },
  "reverseEchoes": false,
  "bonus": false,
  "starsRequired": 0
}
```

## Карта

Одна строка — ряд клеток, север сверху. Короткие строки дополняются пустотой.
Каждый символ ищется сначала в `legend` уровня, затем в стандартной легенде:

| Символ | Значение |
|---|---|
| `#` | стена |
| `.` | пол |
| ` ` | пустота |
| `S` | старт (пол) |
| `X` | выход |
| `o` | ящик |
| `_` | яма |
| `~` | лёд |
| `%` | хрупкий пол (1 проход) |
| `=` | лестница |
| `> < ^ v` | конвейер на восток/запад/север/юг |
| `:` | пол особой зоны (твёрдое эхо) |
| `a b c d` | плита: розовая, циан, фиолетовая, оранжевая |
| `A B C D` | дверь тех же цветов |
| `1 2 3 4` | инверсная дверь тех же цветов |

Значение в легенде — объект или массив объектов (например, портал с ящиком на нём:
`[{"type":"portal","color":"cyan"},{"type":"box"}]`). В клетке может быть не больше одного
приспособления (плита, дверь, рычаг, портал, лёд…), плюс сущности (ящик, предмет, страж, старт)
и флаг зоны.

## Типы в легенде

| type | поля |
|---|---|
| `wall`, `floor`, `void`, `exit`, `box`, `battery`, `ice`, `pit`, `stairs`, `solid` | — |
| `start` | `facing?: N/E/S/W` |
| `key` | `color` |
| `plate` | `color`, `filter?: any/echo/player` |
| `door` | `color`, `inverse?` |
| `timerDoor` | `from`, `to` — тики, когда дверь открыта |
| `lever` | `color`, `on?` |
| `lock`, `socket`, `receiver` | `color` |
| `portal` | `color` (ровно два на цвет) |
| `conveyor` | `dir` |
| `fragile` | `durability?` (1–9) |
| `emitter` | `dir`, `color?`, `invert?` |
| `mirror` | `orient: "/" или "\\"`, `color?` |
| `lift` | `color`, `low?`, `high` |
| `guard` | `route?` (строка из `U R D L`), `mode?: patrol/lure`, `range?`, `facing?` |

Цвета: `pink`, `cyan`, `violet`, `orange`.

## Высоты

`heights` — строки той же формы, что `map`, цифры 0–9 (`.` = 0).

## Подсказки

`hints` — список; показывается первая подходящая. Условия: `minEchoes`, `maxEchoes`,
`afterTick`. `arrow: [x, y]` — 3D-стрелка над клеткой, `keys` — подсвеченные действия
(`up`, `down`, `left`, `right`, `interact`, `record`, `undoEcho`, `rewind`, `wait`),
`touch` — текст для сенсорного управления.

## Эталонное решение

`levelM.solution.json`:

```json
{ "id": "w1-3", "loops": ["RRD", "RRRR", "...RRRRRD"], "echoes": 2, "ticks": 9, "provenMinimal": true }
```

`loops` — ввод каждой петли (`.` ждать, `U R D L` ход, `E` взаимодействие); все петли, кроме
последней, записываются как эхо. Тест `tests/levels.test.ts` проигрывает решение и проверяет
победу. Уровень без проходящего эталона в игру не попадает.
