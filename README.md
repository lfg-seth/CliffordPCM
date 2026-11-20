# CliffordPCM

The 4Runner has two 26-channel 4xPi PCM Rev 6.1 boards and an overhead switch panel on a 250 kbit/s accessory CAN bus. Each PCM connects to an external [Adafruit RP2040 CAN Bus Feather](https://www.adafruit.com/product/5724).

The [baseline notes](docs/baseline.md) record the installed hardware, recovered behavior, verification results and open questions.

## Pattern Studio

Double-click **[Launch Pattern Studio.cmd](Launch%20Pattern%20Studio.cmd)** on Windows. From a terminal, run `python visualizer/server.py --open` with Python 3.10 or newer. Keep that terminal open while using the [local studio](http://127.0.0.1:8765). Playback and editing use the browser and the included stills. PlatformIO is needed for the firmware build check.

- **Studio.** Drag the 4Runner to orbit, switch elevation, or advance one angle at a time. Select an installed fast or slow pattern, click cells to change circuits, and set each step's duration in milliseconds. **Play** runs the selected PCM. The companion checkbox starts the other board on its own clock. Enable **Adjust** and drag a light to position it in the current photo. Select a lens, including a round fog lens, and drag any corner to resize it around the opposite corner. Releasing the mouse saves the edit for that angle and elevation in the selected layout.
- **Wiring.** In **Running boards**, choose **Odd / even per side** for heads 1 and 3 on channel A and 2 and 4 on B, or **Front / rear pairs per side** for heads 1–2 on A and 3–4 on B. Heads are numbered from the front. Choose amber, red, or white independently for Driver A, Driver B, Passenger A, and Passenger B. Each group needs one physical output for its selected color. Assign those outputs under **Output assignments** before exporting a pattern that uses them. The bumper surface lamps and proposed additions start with unconfirmed outputs. Confirm spare channels against the installed harness.
- **Drafts.** Open **Wiring**, select a draft from **Wiring layout**, then use **Duplicate layout**, **Rename draft**, or **Delete draft**. Calibrate your truck in **Current wiring**. New drafts inherit those positions, and each draft can then store alternative placements. Deleting a draft removes its placements. Saved patterns remain in the library.
- **Library.** Keep candidate patterns alongside the four firmware presets. Layouts, mount positions and candidates are saved in browser storage for the local studio address. Use the same browser, hostname, and port to reopen them.
- **Firmware export.** Choose a PCM and fast/slow slot. To install several candidates together, select them under **Other firmware slots** in the same export. Each export starts from the firmware sources in this checkout. Review the wiring changes and build the package. The ZIP contains firmware sources, wiring changes, design data, and a build log. A passing build includes UF2 files for the affected targets. A rewired export updates the corresponding panel actions and build-checks both PCMs and the panel. Exporting works on an isolated copy. Applying a wiring change to the vehicle and uploading firmware are separate operations.

The light positions are estimates from the reference photos. The coded ditch-light circuits have no confirmed fixture positions. Use Wiring to bind them once you identify their loads. The two chase outputs control amber and white, while the red third brake light follows the factory brake signal. When both chase inputs are active, alternating amber and white elements illustrate the two signals.

The factory high beams use a warm, approximately 2700 K preview. Under the vehicle, **High-beam fade on** and **High-beam fade off** set the time for about 95% of a brightness change. Higher values slow the transition. **Haze reach** controls how far the glow extends, and **Haze intensity** controls its strength. The sliders work during playback and their settings are saved in this browser. The PCM supplies on/off power and the installed bulbs provide the physical fade.

The preview and current firmware retain the nominal 5 ms step handoff. A circuit selected in consecutive steps stays powered across the handoff, including the loop from the final step to the first.

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
