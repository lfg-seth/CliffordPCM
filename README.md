# CliffordPCM

The 4Runner has two 26-channel 4xPi PCM Rev 6.1 boards and an overhead switch panel on a 250 kbit/s accessory CAN bus. Each PCM connects to an external [Adafruit RP2040 CAN Bus Feather](https://www.adafruit.com/product/5724).

The [baseline notes](docs/baseline.md) record the installed hardware, recovered behavior, verification results and open questions.

## Firmware

Open this directory as one PlatformIO project. Run `pio run` to build all three environments, or select one below. The builds use the Arduino `pico` board definition from the recovered projects.

| Device | CAN node | Build command |
| --- | --- | --- |
| Engine-bay PCM | `0x01` | `pio run -e engine_bay_pcm` |
| Cargo-bay PCM | `0x02` | `pio run -e cargo_bay_pcm` |
| Overhead switch panel | `0x90` | `pio run -e switch_panel` |

PlatformIO writes each new UF2 and ELF to `.pio/build/<environment>/`. To upload to a connected device, select its environment explicitly with `pio run -e <environment> -t upload`.

Both PCM targets compile [the same firmware](src/pcm/main.cpp). The build environment selects the [node ID, output masks and flash patterns](src/pcm/role.h). The channel-to-PCA9535 pin table is shared. The PCMs explicitly select the Feather's CAN pins (CS 19, MOSI 15, MISO 8, SCK 14).

The [switch-panel action table](src/switch_panel/main.cpp) uses zero-based CAN channel indices for physical outputs 1–26. Inputs 5/6 request cargo patterns 33/34 and inputs 7/8 request engine patterns 31/32, as encoded in the recovered panel image. The panel target retains the recovered Pico/PiCowbell pinout with CAN CS on GPIO20. The installed panel controller still needs physical confirmation.

## Recovered firmware and fabrication files

The engine source comes from `OpenControlHead/firmware/pcm_26ch/src/main-front.cpp` (added in `df730f3`). The cargo source comes from the sibling `main.cpp`, also preserved locally as `main.txt`. The panel source comes from `OpenControlHead/firmware/switch_panel/src/main.cpp`. The original [firmware license](src/LICENSE.md) accompanies the import.

| Recovered image | Original build date (Pacific) | UF2 SHA-256 |
| --- | --- | --- |
| [Engine-bay PCM, UF2 and ELF](artifacts/recovered/engine_bay_pcm/) | July 4, 2026 | `83ea6fa50ef2c20892f1f035bf369677e7ee7d8bac818331fd1d475f12a7a8f9` |
| [Switch panel, UF2 and ELF](artifacts/recovered/switch_panel/) | November 29, 2025 | `e3b68acfd7bace45d892bff9baf120e3d58cb787b1c721cec852df65f3f74371` |

Only source was recovered for the cargo PCM. Its build command above produces a new cargo image.

The [Rev 6.1 fabrication folder](hardware/pcm-rev6.1/) contains the original EasyEDA Gerber ZIP and BOM export for the installed PCM boards.
