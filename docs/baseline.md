# 4Runner firmware baseline · November 18, 2026

Both installed power boards are 4xPi PCM Rev 6.1. Each connects to an external Adafruit RP2040 CAN Bus Feather (#5724). The engine-bay node is `0x01`, the cargo-bay node is `0x02`, and the overhead panel is `0x90`. The three nodes communicate directly over the accessory CAN bus. The O9 control head and Raspberry Pi applications belong to earlier efforts.

The owner selected the last coded channel assignments as the baseline. The panel build uses the recovered Pico/PiCowbell pin configuration. Its CAN chip select is GPIO20, while the Feather uses GPIO19. Physical identification of the installed panel controller and the versions last flashed on all three devices are still open.

## What the firmware does

- The panel reads 17 active-low inputs and sends extended CAN frames at 250 kbit/s on switch changes. Each action sends a two-byte payload containing the zero-based channel or pattern ID and the command. There is no periodic state replay, so a PCM restarted independently can miss a maintained switch position.
- Each PCM drives 26 outputs through two PCA9535 expanders. CAN indices 0–25 address physical channels 1–26. Flash patterns run on the addressed PCM. Panel inputs 5/6 operate cargo patterns 33/34 and inputs 7/8 operate engine patterns 31/32. These destinations follow the action table and the recovered panel image. Some older comments label them in reverse.
- Panel inputs 3, 4 and 13 have no assigned action. Input 12 switches the rock lights on both PCMs. The panel sends commands without a firmware-level status reply. The PCM's PWM command currently maps a nonzero duty value to ON.

The [panel actions](../src/switch_panel/main.cpp) and [PCM role definitions](../src/pcm/role.h) are the references for the assignments and pattern timing.

## Recovery and verification

| Device | Local source of record | Evidence retained |
| --- | --- | --- |
| Engine-bay PCM | `repos/OpenControlHead` at `bb340b3`, using `pcm_26ch/src/main-front.cpp` | July 4, 2026 ELF and UF2. The ELF identifies the front source. |
| Cargo-bay PCM | `Documents/GitHub/OpenControlHead` at `2385730`, using `pcm_26ch/src/main.cpp` | The newer checkout also has identical source as `main.txt`. The cargo UF2 produced during baseline validation is a fresh build. No historical cargo image was located. |
| Switch panel | `repos/OpenControlHead`, using `switch_panel/src/main.cpp`. The recovered image came from the `Documents/GitHub` checkout. | November 29, 2025 ELF and UF2. The compiled pin and action tables match the imported source. |

All three PlatformIO environments compiled. The imported PCM roles were checked against the originals for node ID, channel-to-expander pin assignments, macro IDs, output masks and flash timings. The newly compiled panel matched all 17 input assignments and 32 actions in the archived binary. Both recovered UF2 files matched the flash contents of their companion ELFs. Verification covered source and build artifacts. The installed devices were not flashed or tested during the import.

The [build commands and recovered image hashes](../README.md#firmware) are in the README.

## Rev 6.1 hardware and telemetry

The [Gerbers and BOM](../hardware/pcm-rev6.1/) are the original EasyEDA exports. The two-layer board measures 135 × 80 mm and carries the silkscreen marking **4xPi PCM Rev 6.1**. Twenty single-channel Infineon BTS7004-1EPP switches and three dual-channel ROHM BV2HC045EFU-CE2 switches account for all 26 outputs. The BOM also lists four ADS7830 ADCs, an INA219 current monitor and a TC74 temperature sensor.

Two details matter if telemetry is enabled later.

- **Temperature address.** The BOM specifies TC74A0 at `0x48`. The PCM source uses `0x4D` and leaves temperature polling disabled. The older `PCMCode` bring-up driver also assigns ADC1 to `0x48`. The populated temperature part and ADC address straps would establish whether they share an address. [Microchip TC74 address table](https://ww1.microchip.com/downloads/en/DeviceDoc/21462c.pdf)
- **Current calibration.** The BOM lists R1 as 0.3 mΩ. The older `PCMCode` INA219 driver assumes a 0.1 Ω shunt. The shunt connected to the installed monitor needs confirmation before reusing that calibration.
