#pragma once

#include <stdint.h>

#if defined(PCM_ENGINE_BAY) == defined(PCM_CARGO_BAY)
#error "Select exactly one PCM role: PCM_ENGINE_BAY or PCM_CARGO_BAY"
#endif

struct FlashingStep
{
  uint32_t channelMask; // Bitmask for channels in this step
  uint16_t duration;    // Duration of this step in ms
};

struct FlashingPattern
{
  FlashingStep steps[16]; // Up to 16 steps per pattern
  uint8_t stepCount;      // Number of steps
  uint8_t currentStep;    // Current step index
  bool active;            // Whether the pattern is active

  // Runtime state (for non-blocking timing)
  bool stepOn;             // Are we currently in the "on" phase of this step?
  unsigned long stepStart; // When the current step phase started (ms)
};

constexpr uint32_t EMPTY = 0;

#if defined(PCM_ENGINE_BAY)

constexpr uint8_t PCM_NODE_ID = 0x01;
constexpr uint8_t FAST_FLASH_ID = 31;
constexpr uint8_t SLOW_FLASH_ID = 32;

// Define Channel Masks (bit 0 -> Channel 1, bit 1 -> Channel 2, etc.)
constexpr uint32_t DRIVER_AMBER = 1UL << 0; // Channel 1
constexpr uint32_t PASS_AMBER = 1UL << 1; // Channel 2
constexpr uint32_t FOGS = 1UL << 2; // Channel 3
constexpr uint32_t DRIVER_HIGHBEAM = 1UL << 3; // Channel 4
constexpr uint32_t PASS_HIGHBEAM = 1UL << 4; // Channel 5
constexpr uint32_t LIGHTBAR = 1UL << 5; // Channel 6
constexpr uint32_t ROCK_LIGHTS = 1UL << 6; // Channel 7

constexpr uint32_t PASS_DITCH_HIGH = 1UL << 10; // Channel 11
constexpr uint32_t PASS_DITCH_LOW = 1UL << 11; // Channel 12

constexpr uint32_t GRILL_OUTER_HIGH = 1UL << 13; // Channel 14
constexpr uint32_t GRILL_OUTER_LOW = 1UL << 14; // Channel 15
constexpr uint32_t GRILL_INNER_HIGH = 1UL << 15; // Channel 16
constexpr uint32_t GRILL_INNER_LOW = 1UL << 16; // Channel 17
constexpr uint32_t DRIVER_DITCH_HIGH = 1UL << 17; // Channel 18
constexpr uint32_t DRIVER_DITCH_LOW = 1UL << 18; // Channel 19
constexpr uint32_t GRILL_AMBER = 1UL << 19; // Channel 20

constexpr FlashingPattern FAST_FLASH = {
    {{DRIVER_AMBER | PASS_DITCH_LOW, 50},
     {EMPTY, 50},
     {DRIVER_AMBER | PASS_DITCH_LOW, 50},
     {EMPTY, 200},
     {PASS_AMBER | DRIVER_DITCH_LOW, 50},
     {EMPTY, 50},
     {PASS_AMBER | DRIVER_DITCH_LOW, 50},
     {EMPTY, 200}},
    8,
    0,
    false,
    false,
    0};

constexpr FlashingPattern SLOW_FLASH = {
    {{DRIVER_AMBER, 500},
     {PASS_AMBER, 500}},
    2,
    0,
    false,
    false,
    0};

#else  // PCM_CARGO_BAY

constexpr uint8_t PCM_NODE_ID = 0x02;
constexpr uint8_t FAST_FLASH_ID = 33;
constexpr uint8_t SLOW_FLASH_ID = 34;

// Define Channel Masks (bit 0 -> Channel 1, bit 1 -> Channel 2, etc.)
constexpr uint32_t PASS_REV = 1UL << 0; // Channel 1
constexpr uint32_t PASS_BRAKE = 1UL << 1; // Channel 2

constexpr uint32_t PASS_TURN = 1UL << 3; // Channel 4
constexpr uint32_t DRIVE_REV = 1UL << 4; // Channel 5
constexpr uint32_t DRIVE_BRAKE = 1UL << 5; // Channel 6
constexpr uint32_t DRIVE_TURN = 1UL << 6; // Channel 7
constexpr uint32_t CARGO_LIGHTS = 1UL << 7; // Channel 8
constexpr uint32_t ROCK_LIGHTS = 1UL << 8; // Channel 9

constexpr uint32_t CHASE_AMBER = 1UL << 10; // Channel 11
constexpr uint32_t CHASE_WHITE = 1UL << 11; // Channel 12

constexpr FlashingPattern FAST_FLASH = {
    {{DRIVE_TURN | CHASE_AMBER, 50},
     {EMPTY, 50},
     {DRIVE_TURN | CHASE_WHITE, 50},
     {EMPTY, 200},
     {PASS_TURN | CHASE_AMBER, 50},
     {EMPTY, 50},
     {PASS_TURN | CHASE_WHITE, 50},
     {EMPTY, 200}},
    8,
    0,
    false,
    false,
    0};

constexpr FlashingPattern SLOW_FLASH = {
    {{DRIVE_TURN | PASS_REV, 500},
     {PASS_TURN | DRIVE_REV, 500}},
    2,
    0,
    false,
    false,
    0};

#endif
