# Circuit schematic

- Wokwi project link: https://wokwi.com/projects/468603393620903937
- Exported screenshot: add as `circuit-schematic.png` in this folder (see below)

## Overview

Represents one room (Work Room 1 style: 2 fans + 3 lights) wired through an
ESP32 and 5 relay modules. Each relay switches a load (LED + resistor for
lights, LED/DC motor stand-in for fans) on a shared 5V supply rail. A
potentiometer stands in for an ACS712 current sensor, feeding an analog
reading into the ESP32's ADC.

| ESP32 pin | Drives |
|---|---|
| 13 | Fan 1 relay |
| 12 | Fan 2 relay |
| 14 | Light 1 relay |
| 27 | Light 2 relay |
| 26 | Light 3 relay |
| 34 | Current sense (potentiometer stand-in) |

Sketch: `sketch.ino` in this same folder — mirrors the backend simulator's
device shape (2 fans @ 60W, 3 lights @ 15W) and supports manual control via
Serial Monitor commands (`fan1 on`, `light2 off`, `status`, etc.) for live
demo purposes.

See the main README's "Diagrams" section for how this fits into the overall
architecture.
